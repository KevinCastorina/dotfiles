# Dotfiles

Best practices dotfiles repository for macOS, Arch-based Linux (CachyOS) and
Debian/Ubuntu, including Devcontainers.
Managed with [chezmoi](https://www.chezmoi.io/).

## Features

- **Cross-platform**: Works on macOS, Arch-based Linux (CachyOS, Arch, EndeavourOS, Manjaro) and Debian/Ubuntu, including Devcontainers.
- **Devcontainer Ready**: Designed to be installed automatically as containers spin up.
- **No Admin Required**: Homebrew is installed into `~/.linuxbrew` on Linux, so no `sudo` is ever needed - not even for the sandbox dependencies.
- **One package manager**: Homebrew (bottles, no compilation) on every platform; pre-built binaries only as a fallback where Homebrew is unavailable.
- **Modern CLI Tools**: Includes configuration for `ripgrep`, `bat`, `eza`, `fzf`, `zoxide`, `fd`.
- **Shell**: `zsh`, `bash` and `fish` startup files are managed directly by chezmoi (no oh-my-zsh / oh-my-fish required).
- **Coding Agent**: [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt) ahead-of-time compiled native Pi coding agent (`PI_OFFLINE=1`).
- **Sandboxed Agent**: [pi-permission-modes](https://github.com/wynainfo/pi-permission-modes) — switchable **Default → Plan Mode → Build → YOLO** modes for Pi-Bolt, each pairing a `bubblewrap` OS sandbox with an allow / ask / deny policy, a network allowlist and live prompts (still no `sudo`).

## Installation

### Automatic (One-line)

If you have a GitHub account:

```bash
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply YOUR_USERNAME
```

Or using the full repository URL:

```bash
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply https://github.com/YOUR_USERNAME/REPO_NAME.git
```

> Any existing unmanaged `~/.bashrc` / `~/.zshrc` / `~/.config/fish/config.fish`
> is moved to `.bashrc.local` / `.zshrc.local` / `config.local.fish` before the
> managed versions are applied, and the managed files source it again.

### Manual / Devcontainer (Cloned)

If the repository is already cloned (e.g., inside a Devcontainer or manual clone):

```bash
git clone https://github.com/YOUR_USERNAME/REPO_NAME.git ~/.dotfiles
cd ~/.dotfiles
./install.sh
```

## Structure

- `install.sh`: Bootstrapper script (installs chezmoi, applies dotfiles, backs up existing rc files).
- `.chezmoi.toml.tmpl`: Chezmoi configuration template.
- `.chezmoiignore`: Files in the repo that are never installed into `$HOME`.
- `.chezmoitemplates/shellrc.tmpl`: Shared shell configuration, rendered per shell.
- `dot_zshrc.tmpl` / `dot_bashrc.tmpl`: Managed `~/.zshrc` / `~/.bashrc` (Linux installs both).
- `dot_config/fish/config.fish`: Managed `~/.config/fish/config.fish` (see [fish](#fish)).
- `.chezmoiscripts/`: Scripts to run during `chezmoi apply` (install packages, setup tools).
- `dot_config/`: Configuration files for other tools.

## CachyOS / Arch-based (and other Linux)

On Linux the dotfiles use **Homebrew, installed into `~/.linuxbrew`** by
`.chezmoiscripts/run_onchange_install-brew-packages.sh.tmpl`. That is Homebrew's
official root-free install (`git clone` + symlink to `bin/brew`), so
`/home/linuxbrew` (root-owned) is deliberately avoided. `pacman` is *not* used
by the dotfiles - the system packages stay exactly as CachyOS ships them.

Bottles verified on CachyOS: `fish`, `ripgrep`, `bat`, `eza`, `fd`, `fzf`,
`zoxide`, `bubblewrap`, `socat` all pour from `*.x86_64_linux.bottle` - nothing
is compiled and no build toolchain is required.

```bash
./install.sh                          # installs Homebrew to ~/.linuxbrew if missing
DOTFILES_INSTALL_BREW=0 ./install.sh  # never install it; use ~/.local/bin binaries
```

Details:

- `brew` is looked up in `~/.linuxbrew`, `/home/linuxbrew/.linuxbrew`,
  `/opt/homebrew`, `/usr/local` - in that order, in the install scripts and in
  the managed `.bashrc` / `.zshrc` / `config.fish` (`brew shellenv`).
- Order matters and is enforced by the script names: `install-brew-packages` runs
  before `install-linux-binaries`, and the latter only fetches tools that are
  still missing (it puts the Homebrew bin dirs on `PATH` to check).
- No `sudo` anywhere: `~/.linuxbrew`, `~/.local/bin` and `~/.pi` are user-owned.
- Running as root: Homebrew refuses to run as root, so the pre-built binaries in
  `~/.local/bin` are used instead (the devcontainer runs as its normal user, so
  it does get Homebrew).
- If you installed Homebrew the conventional way (`/home/linuxbrew`, needs root),
  it still works - the scripts and rc files pick it up as a second choice.
- Cost to keep in mind: a fresh `~/.linuxbrew` with this Brewfile is ~360-390 MB and
  a few minutes of downloads (bottles only, no compilation) - also on every
  devcontainer/CI run. For throwaway environments use
  `DOTFILES_INSTALL_BREW=0`, then the tools land in `~/.local/bin`.
- Default shell: CachyOS already uses `fish`. On a fresh Arch install:
  `chsh -s /usr/bin/fish` or `DOTFILES_DEFAULT_SHELL=fish ./install.sh`.

Note: `~/.linuxbrew/bin` comes before `/usr/bin` in `PATH`, so Homebrew's `fish`,
`rg`, `bat`, … shadow the pacman packages of the same name. Remove the
`brew "…"` line from `~/.Brewfile` if you prefer the system package for a tool.

## fish

`dot_config/fish/config.fish` is the fish port of
`.chezmoitemplates/shellrc.tmpl` - same `PATH`, `EDITOR`, modern CLI aliases
(`cat`/`ls`/`ll`/`la`/`grep`), `zoxide` and `fzf` integrations, `PI_OFFLINE=1`.
It is applied on every platform and stays inert if `fish` is not installed.

```
~/.config/fish/config.fish        managed by chezmoi
~/.config/fish/config.local.fish  your settings, never touched (sourced first)
/usr/share/cachyos-fish-config/   CachyOS defaults, sourced by the managed file
```

- `brew shellenv` is called with an explicit shell everywhere (`shellenv fish`
  for fish - without the argument brew prints sh syntax, which fish cannot
  parse), and `HOMEBREW_NO_ANALYTICS` / `HOMEBREW_NO_ENV_HINTS` are set.
- The CachyOS system defaults (fastfetch greeting, `eza` aliases, bang-bang
  history bindings, `done` notifications) are kept by sourcing
  `/usr/share/cachyos-fish-config/cachyos-config.fish`; the managed aliases are
  defined afterwards and therefore win.
- Aliases, key bindings and completions are only set for interactive shells, so
  `fish -c ...` and script shebangs stay fast.
- The prompt is fish's default (short path + git branch), which matches the
  `~ (branch) ➜` prompt of the bash/zsh setup.
- Install `fish` on non-Arch systems with your package manager (`brew install
  fish`, `apt install fish`); the health check reports it as optional.

## Devcontainers

To use these dotfiles in your Devcontainers:

1. Open VS Code Settings.
2. Search for "Dotfiles".
3. Set **Dotfiles: Repository** to your repository URL.
4. Set **Dotfiles: Install Command** to `./install.sh`.

Alternatively, you can add this to your `devcontainer.json`:

```json
"onCreateCommand": "sh -c \"$(curl -fsLS https://raw.githubusercontent.com/YOUR_USERNAME/REPO_NAME/main/install.sh)\""
```

## Icons

`eza` file-listing icons are enabled only when the `DOTFILES_ICONS=1`
environment variable is set (a Nerd Font is required).

## Pi-Bolt sandbox (permission modes)

[pi-permission-modes](https://github.com/wynainfo/pi-permission-modes) is the
sandbox for Pi-Bolt. Four switchable modes - **Default -> Plan Mode -> Build ->
YOLO** (`alt+m`, `/perm <mode>`) - each pair an OS-level sandbox with an
allow / ask / deny policy for every tool:

| Mode | Behavior |
|------|----------|
| **Default** | Confirm every `bash`/`edit`/`write`; an approved in-project `bash` runs **sandboxed** (writes confined to the project) |
| **Plan Mode** | In-project `bash` is **read-only**; the model writes a plan to `plan/` and hands it over for Accept / Decline |
| **Build** | Reads, writes and in-project `bash` run without confirmation, sandboxed |
| **YOLO** | No prompts, no sandbox |

Outside the project: out-of-project access prompts, `sudo` and friends always
prompt (detected structurally, even inside `bash -c`), and `edit`/`write` to
protected paths (`.git/`, `.env`, dotfiles) are hard-blocked. In-project
`bash` runs wrapped by `bubblewrap`, with writes confined to the project and
network traffic filtered by a domain allowlist; a request to a host outside it
**pauses while you are asked** (allow once / for the session / forever / deny).
`/sandbox` prints the active configuration.

Installed on Linux and macOS by `chezmoi apply`
(`.chezmoiscripts/run_onchange_install-permission-modes.sh.tmpl`):

- `pi-bolt install npm:pi-permission-modes` - user-scope package, dependencies
  under `~/.pi/agent/npm`
- Linux sandbox deps: `brew install bubblewrap socat` (Homebrew bottles, so no
  `sudo` and no root-owned prefix); `ripgrep` is already managed above. macOS
  needs neither - it uses the built-in `sandbox-exec`
- optional global config: `~/.pi/agent/permission-mode/permission-mode.json`,
  written by `/perm init`; a project may add `.pi/permission-mode.json`, which
  can only make things stricter

```bash
pi-bolt                      # footer shows the mode; alt+m cycles it
pi-bolt --perm build         # start in a mode: default | plan | build | yolo
pi-bolt --no-sandbox         # keep the modes, drop OS sandboxing
/perm init                   # copy the stock modes to the global config
/net, /sandbox, /shells      # network policy, sandbox state, background shells
```

Nothing needs `sudo`: the Homebrew prefix (`~/.linuxbrew`), `~/.local/bin` and
`~/.pi` are user-owned. If `bubblewrap`/`socat` are missing, the sandboxed modes
degrade to **prompting only** and say so in the footer (`(!) sandbox-runtime
missing`) - never silently unprotected. The complete reference ships with the
package:
`~/.pi/agent/npm/node_modules/pi-permission-modes/docs/`.
