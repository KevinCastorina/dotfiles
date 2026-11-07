/**
 * Pi + Gondolin Sandbox extension (installed by the dotfiles repo)
 *
 * This extension overrides pi's built-in `read`/`write`/`edit`/`bash` tools so
 * they execute inside a Gondolin micro-VM instead of on the host.
 *
 * The directory you start `pi` in is mounted read-write at `/workspace` inside
 * the VM.
 *
 * How it is installed (dotfiles, no root/sudo needed):
 *   chezmoi apply writes ~/.pi/agent/extensions/gondolin/{index.ts,package.json}
 *   .chezmoiscripts/run_onchange_install-gondolin.sh.tmpl provisions the deps:
 *     brew install node qemu        (Linuxbrew bottles, user-owned prefix)
 *     npm install --ignore-scripts  (@earendil-works/gondolin + the runner)
 *
 * Usage: start Pi-Bolt in the project you want to sandbox:
 *   cd /path/to/your/project
 *   pi-bolt                 # auto-discovered from ~/.pi/agent/extensions
 *   pi-bolt -e ~/.pi/agent/extensions/gondolin/index.ts   # one-off run
 *   pi-bolt config          # Tab -> user scope, uncheck "gondolin" to disable
 *
 * Policy (all env vars, per session):
 *   - Egress HTTP: every host allowed except GONDOLIN_BLOCK_HOSTS
 *     (default: aliyuncs.com + *.aliyuncs.com). Blocked hosts never prompt.
 *   - Ask-on-first-target: the first request to each unseen host is confirmed
 *     in the TUI (allow this host / allow *.parent / deny). Memorized for the
 *     lifetime of the VM. Disable with GONDOLIN_CONFIRM_HOSTS=off.
 *     Without a UI (print mode) the prompt is unanswered -> deny.
 *   - SSH egress: enabled when SSH_AUTH_SOCK is set. git-over-ssh is confirmed
 *     per repo (or per host), other ssh exec commands per host.
 *   - host_cli tool: nothing is allowed by default. Set PI_HOST_CLI_COMMANDS
 *     (e.g. "docker,kubectl") or PI_HOST_CLI_ALL=1 / PI_HOST_CLI_COMMANDS="*"
 *     to open it. Commands run on the HOST, allowlisted by binary, confirmed
 *     per call.
 *
 * Notes:
 *   - The VM is started on `session_start` (and lazily if a tool is used before that)
 *   - User `!` commands are also executed inside the VM
 *   - pi's host environment is not forwarded to the guest (no API keys in there);
 *     give the VM secrets with `secrets` in createHttpHooks instead
 *   - Module resolution happens relative to this file, so the npm install lands
 *     in ~/.pi/agent/extensions/gondolin/node_modules next to it
 */

import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";

import {
  createHttpHooks,
  getInfoFromSshExecRequest,
  RealFSProvider,
  type SshExecDecision,
  type SshExecRequest,
  VM,
} from "@earendil-works/gondolin";

const GUEST_WORKSPACE = "/workspace";

// ---------------------------------------------------------------------------
// Deny list (blacklist). Everything else is allowed by default.
// ---------------------------------------------------------------------------

const DEFAULT_BLOCK_HOSTS = ["aliyuncs.com", "*.aliyuncs.com"];
const blockHosts = (process.env.GONDOLIN_BLOCK_HOSTS ?? "")
  .split(",")
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean);
if (blockHosts.length === 0) blockHosts.push(...DEFAULT_BLOCK_HOSTS);

// Same wildcard syntax as gondolin's allowlists: "*.example.com" matches
// subdomains only, "*" matches anything.
function hostMatchesPattern(hostname: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  return hostname === pattern;
}

function hostBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return blockHosts.some((p) => hostMatchesPattern(host, p));
}

/** `api.foo.com` -> `*.foo.com`, `foo.com` -> `*.foo.com`, single-label -> null */
function wildcardFor(hostname: string): string | null {
  if (!hostname.includes(".")) return null;
  const dot = hostname.indexOf(".");
  const parent = hostname.slice(dot + 1);
  if (!parent.includes(".")) return `*.${hostname}`;
  return `*.${parent}`;
}

/** "host" = trust exact host, "wildcard" = trust *.parent, "deny" = block */
type HttpDecision = "host" | "wildcard" | "deny";
/** "repo" = trust specific repo, "host" = trust all repos on host, "deny" = block */
type GitDecision = "repo" | "host" | "deny";

// ---------------------------------------------------------------------------
// Ask-on-first-target prompting (serialized, memorized per VM)
// ---------------------------------------------------------------------------

const confirmEnabled = process.env.GONDOLIN_CONFIRM_HOSTS !== "off";

class PromptQueue {
  private gate: Promise<void> = Promise.resolve();

  /** Run `fn` after every earlier prompt finished, so prompts never interleave. */
  async serialized<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const prompts = new PromptQueue();

async function ask(
  ctx: ExtensionContext | undefined,
  title: string,
  question: string,
  options: string[],
): Promise<string | null> {
  if (!ctx?.hasUI || !ctx.ui) {
    // Print / JSON mode: nothing can answer, so fail closed.
    ctx?.ui?.notify?.(`${question} (no UI, default: deny)`, "info");
    return null;
  }
  ctx.ui.setStatus("gondolin", `waiting for decision: ${title}`);
  try {
    return await ctx.ui.select(title, options);
  } finally {
    ctx.ui.setStatus("gondolin", "running");
  }
}

class HttpGate {
  private decisions = new Map<string, boolean>();
  private pending = new Map<string, Promise<boolean>>();

  constructor(private ctx: ExtensionContext | undefined) {}

  private lookup(hostname: string, port: number): boolean | undefined {
    const exact = this.decisions.get(`${hostname}:${port}`);
    if (exact !== undefined) return exact;
    const self = this.decisions.get(`*.${hostname}:${port}`);
    if (self !== undefined) return self;
    let h = hostname;
    while (true) {
      const dot = h.indexOf(".");
      if (dot < 0 || dot === h.length - 1) break;
      const parent = h.slice(dot + 1);
      const wc = this.decisions.get(`*.${parent}:${port}`);
      if (wc !== undefined) return wc;
      h = parent;
    }
    return undefined;
  }

  async allow(
    hostname: string,
    port: number,
    method: string,
    url: string,
  ): Promise<boolean> {
    const existing = this.lookup(hostname, port);
    if (existing !== undefined) return existing;

    const key = `${hostname}:${port}`;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;

    const decision = prompts.serialized(async (): Promise<HttpDecision> => {
      const wc = wildcardFor(hostname);
      const wcLabel = wc ? `Allow ${wc}:${port} (all subdomains)` : null;
      const options = [
        `Allow ${key}`,
        ...(wcLabel ? [wcLabel] : []),
        `Deny ${key}`,
      ];
      const answer = await ask(
        this.ctx,
        "Gondolin egress",
        `Allow ${method} ${url} to ${key}?`,
        options,
      );
      if (answer === null || answer.startsWith("Deny")) return "deny";
      return wcLabel && answer === wcLabel ? "wildcard" : "host";
    });

    const promise = decision.then((d) => {
      const allow = d !== "deny";
      if (d === "wildcard") {
        const wc = wildcardFor(hostname);
        if (wc) this.decisions.set(`${wc}:${port}`, true);
      }
      this.decisions.set(key, allow);
      return allow;
    });
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }
}

class SshGate {
  private hostDecisions = new Map<string, boolean>();
  private gitDecisions = new Map<string, boolean>();
  private hostPending = new Map<string, Promise<boolean>>();
  private gitPending = new Map<string, Promise<boolean>>();

  constructor(private ctx: ExtensionContext | undefined) {}

  private gitKey(op: "clone" | "push", host: string, port: number, repo: string) {
    return `${op}|${host}:${port}|${repo}`;
  }

  async decide(req: SshExecRequest): Promise<SshExecDecision> {
    const hostname = req.hostname.toLowerCase();
    const port = req.port;
    const hostKey = `${hostname}:${port}`;

    if (hostBlocked(hostname)) {
      return {
        allow: false,
        exitCode: 1,
        message: `blocked by gondolin deny list: ${hostKey}`,
      };
    }

    const gitInfo = getInfoFromSshExecRequest(req);
    const service = gitInfo?.service ?? "";
    const op: "clone" | "push" | null =
      service === "git-upload-pack" || service === "git-upload-archive"
        ? "clone"
        : service === "git-receive-pack"
          ? "push"
          : null;

    if (gitInfo && op) {
      const key = this.gitKey(op, hostname, port, gitInfo.repo);
      const known =
        this.gitDecisions.get(key) ??
        this.gitDecisions.get(this.gitKey(op, hostname, port, "*"));
      if (known !== undefined) return { allow: known };

      const inflight = this.gitPending.get(key);
      if (inflight) return { allow: await inflight };

      const promise = prompts.serialized(async (): Promise<GitDecision> => {
        const opLabel = op === "clone" ? "clone/fetch" : "push";
        const answer = await ask(
          this.ctx,
          "Gondolin git over SSH",
          `Allow git ${opLabel} via SSH to ${hostKey}?\nRepo: ${gitInfo.repo}`,
          [
            `Allow ${gitInfo.repo}`,
            `Allow all repos on ${hostKey}`,
            "Deny",
          ],
        );
        if (answer === null || answer === "Deny") return "deny";
        return answer === `Allow ${gitInfo.repo}` ? "repo" : "host";
      }).then((d) => {
        const allow = d !== "deny";
        if (d === "host") {
          this.gitDecisions.set(this.gitKey(op, hostname, port, "*"), true);
        } else {
          // deny keeps future prompts for other repos on this host
          this.gitDecisions.set(key, allow);
        }
        return allow;
      });

      this.gitPending.set(key, promise);
      try {
        const allow = await promise;
        if (allow) return { allow: true };
        return {
          allow: false,
          exitCode: 1,
          message: `git ${op} denied by user: ${hostKey} ${gitInfo.repo}`,
        };
      } finally {
        this.gitPending.delete(key);
      }
    }

    // non-git ssh exec: prompt per host
    const known = this.hostDecisions.get(hostKey);
    if (known !== undefined) return { allow: known };
    const inflight = this.hostPending.get(hostKey);
    if (inflight) return { allow: await inflight };

    const promise = prompts
      .serialized(async () => {
        const answer = await ask(
          this.ctx,
          "Gondolin SSH",
          `Allow SSH exec to ${hostKey}?\nCommand: ${req.command}`,
          [`Allow ${hostKey}`, `Deny ${hostKey}`],
        );
        return answer !== null && !answer.startsWith("Deny");
      })
      .then((allow) => {
        this.hostDecisions.set(hostKey, allow);
        return allow;
      });

    this.hostPending.set(hostKey, promise);
    try {
      const allow = await promise;
      if (allow) return { allow: true };
      return { allow: false, exitCode: 1, message: `ssh denied by user: ${hostKey}` };
    } finally {
      this.hostPending.delete(hostKey);
    }
  }
}

function shQuote(value: string): string {
  // POSIX shell quoting: wraps in single quotes and escapes internal quotes
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function toGuestPath(localCwd: string, localPath: string): string {
  // pi tools pass absolute local paths; map them into /workspace.
  const rel = path.relative(localCwd, localPath);
  if (rel === "") return GUEST_WORKSPACE;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  // Convert platform separators to POSIX for the Linux guest
  const posixRel = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join(GUEST_WORKSPACE, posixRel);
}

function createGondolinReadOps(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: async (p) => {
      return vm.fs.readFile(toGuestPath(localCwd, p));
    },
    access: async (p) => {
      await vm.fs.access(toGuestPath(localCwd, p), { mode: fsConstants.R_OK });
    },
    detectImageMimeType: async (p) => {
      const guestPath = toGuestPath(localCwd, p);
      try {
        // Run through the shell because `file` might live in `/usr/bin` depending on the image
        const r = await vm.exec([
          "/bin/sh",
          "-lc",
          `file --mime-type -b ${shQuote(guestPath)}`,
        ]);
        if (!r.ok) return null;
        const m = r.stdout.trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
          m,
        )
          ? m
          : null;
      } catch {
        return null;
      }
    },
  };
}

function createGondolinWriteOps(vm: VM, localCwd: string): WriteOperations {
  return {
    // Use the VM filesystem API rather than a shell round-trip: it streams the
    // content, so there is no argv size limit and no quoting to get wrong.
    writeFile: async (p, content) => {
      const guestPath = toGuestPath(localCwd, p);
      await vm.fs.mkdir(path.posix.dirname(guestPath), { recursive: true });
      await vm.fs.writeFile(guestPath, content);
    },
    mkdir: async (dir) => {
      await vm.fs.mkdir(toGuestPath(localCwd, dir), { recursive: true });
    },
  };
}

function createGondolinEditOps(vm: VM, localCwd: string): EditOperations {
  const r = createGondolinReadOps(vm, localCwd);
  const w = createGondolinWriteOps(vm, localCwd);
  return { readFile: r.readFile, access: r.access, writeFile: w.writeFile };
}

function createGondolinBashOps(vm: VM, localCwd: string): BashOperations {
  return {
    // The host environment passed by pi is intentionally not forwarded: it
    // usually contains API keys and other credentials.  Configure secrets for
    // the guest with `httpHooks` (see docs/secrets.md) instead.
    exec: async (command, cwd, { onData, signal, timeout }) => {
      const guestCwd = toGuestPath(localCwd, cwd);

      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener("abort", onAbort, { once: true });

      let timedOut = false;
      const timer =
        timeout && timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              ac.abort();
            }, timeout * 1000)
          : undefined;

      try {
        // `/bin/bash -lc` for a familiar environment (pipelines, expansions, etc.)
        const proc = vm.exec(["/bin/bash", "-lc", command], {
          cwd: guestCwd,
          signal: ac.signal,
          stdout: "pipe",
          stderr: "pipe",
        });

        for await (const chunk of proc.output()) {
          onData(chunk.data);
        }

        const r = await proc;
        return { exitCode: r.exitCode };
      } catch (err) {
        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// host_cli: cluster/deploy tooling that must run on the host.
// Allowlisted by binary, confirmed per call, fail closed without a UI.
// ---------------------------------------------------------------------------

// No default allowlist: host_cli stays closed until you opt in.
const hostCommands = (process.env.PI_HOST_CLI_COMMANDS ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

/** PI_HOST_CLI_COMMANDS="*" (or PI_HOST_CLI_ALL=1) allows any binary. */
const allowAllHostCommands =
  hostCommands.includes("*") || process.env.PI_HOST_CLI_ALL === "1";

/** First real token of a command line, skipping leading env assignments and sudo. */
function primaryBinary(command: string): string {
  const tokens = command.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  let token = tokens[i] ?? "";
  if (token === "sudo") token = tokens[i + 1] ?? "";
  return token.split("/").pop() ?? "";
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export default function (pi: ExtensionAPI) {
  const localCwd = process.cwd();

  const localRead = createReadTool(localCwd);
  const localWrite = createWriteTool(localCwd);
  const localEdit = createEditTool(localCwd);
  const localBash = createBashTool(localCwd);

  let vm: VM | null = null;
  let vmStarting: Promise<VM> | null = null;
  /** last seen context, used by the lazy tool path and by the egress prompts */
  let lastCtx: ExtensionContext | undefined;

  async function ensureVm(ctx?: ExtensionContext) {
    if (ctx) lastCtx = ctx;
    if (vm) return vm;
    if (vmStarting) return vmStarting;

    vmStarting = (async () => {
      const activeCtx = lastCtx;
      activeCtx?.ui.setStatus(
        "gondolin",
        activeCtx.ui.theme.fg(
          "accent",
          `Gondolin: starting (mount ${GUEST_WORKSPACE})`,
        ),
      );

      const gate = new HttpGate(activeCtx);
      const { httpHooks, env } = createHttpHooks({
        allowedHosts: undefined, // omitted = allow all
        isRequestAllowed: async (request) => {
          let url: URL;
          try {
            url = new URL(request.url);
          } catch {
            return false; // malformed url: fail closed
          }
          if (url.protocol !== "https:" && url.protocol !== "http:") return false;
          const hostname = url.hostname.toLowerCase();
          if (!hostname) return false;

          // The deny list wins: blocked hosts are never prompted.
          if (hostBlocked(hostname)) return false;
          if (!confirmEnabled) return true;

          const port = url.port
            ? Number(url.port)
            : url.protocol === "https:"
              ? 443
              : 80;
          if (!Number.isFinite(port) || port <= 0) return false;
          return gate.allow(hostname, port, request.method, request.url);
        },
      });

      const sshAgent = process.env.SSH_AUTH_SOCK;
      const sshGate = new SshGate(activeCtx);
      const ssh = sshAgent
        ? {
            allowedHosts: ["*"],
            agent: sshAgent,
            knownHostsFile: process.env.HOME
              ? path.join(process.env.HOME, ".ssh", "known_hosts")
              : undefined,
            execPolicy: (req: SshExecRequest) => sshGate.decide(req),
          }
        : undefined;

      const created = await VM.create({
        httpHooks,
        env,
        ssh,
        vfs: {
          mounts: {
            [GUEST_WORKSPACE]: new RealFSProvider(localCwd),
          },
        },
      });

      vm = created;
      const policy = `${blockHosts.length} blocked host pattern(s)`;
      activeCtx?.ui.setStatus(
        "gondolin",
        activeCtx.ui.theme.fg(
          "accent",
          `Gondolin: running (${localCwd} -> ${GUEST_WORKSPACE})${
            confirmEnabled ? ", ask on first target" : ""
          }${ssh ? ", ssh egress" : ""} - ${policy}`,
        ),
      );
      activeCtx?.ui.notify(
        `Gondolin VM ready. Host ${localCwd} mounted at ${GUEST_WORKSPACE}. Egress: allow all except ${blockHosts.join(", ")}.`,
        "info",
      );
      return created;
    })();

    return vmStarting;
  }

  pi.on("session_start", async (_event, ctx) => {
    // Start eagerly so the user sees errors early (missing qemu, etc.)
    await ensureVm(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!vm) return;
    ctx.ui.setStatus(
      "gondolin",
      ctx.ui.theme.fg("muted", "Gondolin: stopping"),
    );
    try {
      await vm.close();
    } finally {
      vm = null;
      vmStarting = null;
    }
  });

  pi.registerTool({
    ...localRead,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createReadTool(localCwd, {
        operations: createGondolinReadOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localWrite,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createWriteTool(localCwd, {
        operations: createGondolinWriteOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localEdit,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createEditTool(localCwd, {
        operations: createGondolinEditOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  pi.registerTool({
    ...localBash,
    async execute(id, params, signal, onUpdate, ctx) {
      const activeVm = await ensureVm(ctx);
      const tool = createBashTool(localCwd, {
        operations: createGondolinBashOps(activeVm, localCwd),
      });
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  // docker/kubectl/helm on the HOST, outside the VM. Deliberately narrow:
  // only allowlisted binaries, and every call is confirmed.
  pi.registerTool({
    ...localBash,
    name: "host_cli",
    label: "Host CLI",
    description: allowAllHostCommands
      ? `Run ANY command on the HOST (outside the sandbox VM). Each call is confirmed. ` +
        `Ordinary builds, tests and file edits belong in the VM tools instead.`
      : hostCommands.length === 0
        ? `Run a host command outside the sandbox VM. Currently no binaries are ` +
          `allowed (set PI_HOST_CLI_COMMANDS="docker,kubectl,..." or ` +
          `PI_HOST_CLI_ALL=1). Each call is confirmed.`
        : `Run a host command on the HOST (outside the sandbox VM). ` +
          `Allowed binaries: ${hostCommands.join(", ")}. Each call is confirmed. ` +
          `Ordinary builds, tests and file edits belong in the VM tools instead.`,
    async execute(id, params, signal, onUpdate, ctx) {
      const command = (params as { command: string }).command ?? "";
      const binary = primaryBinary(command);

      if (!allowAllHostCommands && !hostCommands.includes(binary)) {
        const allowed = hostCommands.length
          ? hostCommands.join(", ")
          : "nothing (set PI_HOST_CLI_COMMANDS or PI_HOST_CLI_ALL=1)";
        return textResult(`host_cli: "${binary}" is not allowed. Allowed: ${allowed}`);
      }

      if (!ctx?.hasUI) {
        ctx?.ui?.notify?.(`host_cli ${command} (no UI, default: deny)`, "info");
        return textResult(`host_cli: denied (no interactive UI available)`);
      }

      const cwd = (params as { cwd?: string }).cwd ?? localCwd;
      const answer = await ask(
        ctx,
        "host_cli",
        `Run ${binary} on the HOST (not in the VM)?\n${command}\ncwd: ${cwd}`,
        ["Allow", "Deny"],
      );
      if (answer !== "Allow") {
        return textResult(`host_cli: denied by user (${binary})`);
      }

      // host operations: the untouched createBashTool uses the host filesystem
      const tool = createBashTool(localCwd);
      return tool.execute(id, params, signal, onUpdate);
    },
  });

  // Run user `!` commands inside the VM too
  pi.on("user_bash", (_event, _ctx) => {
    if (!vm) return;
    return { operations: createGondolinBashOps(vm, localCwd) };
  });

  // Replace the CWD line in the system prompt so the model sees /workspace
  pi.on("before_agent_start", async (event, ctx) => {
    await ensureVm(ctx);
    const modified = event.systemPrompt.replace(
      `Current working directory: ${localCwd}`,
      `Current working directory: ${GUEST_WORKSPACE} (Gondolin VM, mounted from host: ${localCwd})`,
    );
    return { systemPrompt: modified };
  });
}
