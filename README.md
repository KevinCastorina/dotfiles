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
- **Sandboxed Agent**: [Gondolin](https://github.com/earendil-works/gondolin) micro-VM extension — Pi-Bolt's `read`/`write`/`edit`/`bash` run inside a QEMU VM (Linux only, still no `sudo`).

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
- `dot_pi/agent/extensions/gondolin/`: Gondolin sandbox extension for Pi-Bolt (`index.ts` + `package.json`), installed to `~/.pi/agent/extensions/gondolin`.

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

## Pi-Bolt sandbox (Gondolin)

[Gondolin](https://github.com/earendil-works/gondolin) runs Pi-Bolt's
`read`/`write`/`edit`/`bash` tools (and `!` commands) inside a QEMU micro-VM,
with the directory you start `pi-bolt` in mounted read-write at `/workspace`.

Installed on Linux by `chezmoi apply`:

- files: `dot_pi/agent/extensions/gondolin/{index.ts,package.json}` → `~/.pi/agent/extensions/gondolin/`
- deps: `.chezmoiscripts/run_onchange_install-gondolin.sh.tmpl` runs
  `brew install node qemu` (node `>=22.19`, Linuxbrew bottles) and
  `npm install --ignore-scripts` inside that directory
- first VM boot caches the guest image assets in `~/.cache/gondolin` (~300 MB)

Nothing needs `sudo`: the Homebrew prefix and `~/.pi` are user-owned. Skipped in
CI (`CI=1`) because QEMU is a heavy install.

```bash
pi-bolt                     # VM starts at session_start; footer shows "Gondolin: running"
pi-bolt -ne                 # no extensions at all (unsandboxed)
pi-bolt -e ~/.pi/agent/extensions/gondolin/index.ts   # one-off sandboxed run
pi-bolt config              # Tab -> user scope, uncheck "gondolin" to disable
```

### Network policy

Every host is allowed **except** the deny list, which defaults to
`aliyuncs.com` and `*.aliyuncs.com` (subdomains match, `notaliyuncs.com` does
not). Requests to a blocked host are answered by the host-side mediator with
`403` before anything leaves the machine. Change the deny list per session
without re-applying dotfiles:

```bash
GONDOLIN_BLOCK_HOSTS="aliyuncs.com,*.aliyuncs.com,*.internal.example" pi-bolt
```

Notes: the guest has no credentials in its environment (pi's host env is not
forwarded) — give the VM secrets with `httpHooks`/`secrets` instead. Requests to
bare IP addresses fail closed (the TLS bridge has no hostname to match).

### Optional KVM acceleration

Without `/dev/kvm` access QEMU uses TCG software emulation (VM boots fine, just
slowly: ~300 MB RSS for the qemu process, guest RAM default 1 GiB). On a host
where you have root, add your user to the `kvm` group once:

```bash
sudo usermod -aG kvm "$USER"   # then re-login
```
