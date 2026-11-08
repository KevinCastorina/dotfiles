# Dotfiles

Best practices dotfiles repository for macOS, Unix, and Devcontainers (Debian).
Managed with [chezmoi](https://www.chezmoi.io/).

## Features

- **Cross-platform**: Works on macOS and Linux (Debian/Ubuntu).
- **Devcontainer Ready**: Designed to be installed automatically as containers spin up.
- **No Admin Required**: optimized for environments without `sudo` access (corporate workstations, restricted containers).
- **Modern CLI Tools**: Includes configuration for `ripgrep`, `bat`, `eza`, `fzf`, `zoxide`, `fd`.
- **Shell**: `zsh` and `bash` startup files are managed directly by chezmoi (no oh-my-zsh required).
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

> Any existing unmanaged `~/.bashrc` / `~/.zshrc` is moved to `.local` before
> the managed versions are applied.

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
- `.chezmoiscripts/`: Scripts to run during `chezmoi apply` (install packages, setup tools).
- `dot_config/`: Configuration files for other tools.

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

Nothing needs `sudo`: the Homebrew prefix and `~/.pi` are user-owned. If
`bubblewrap`/`socat` are missing, the sandboxed modes degrade to **prompting
only** and say so in the footer (`(!) sandbox-runtime missing`) - never silently
unprotected. The complete reference ships with the package:
`~/.pi/agent/npm/node_modules/pi-permission-modes/docs/`.
