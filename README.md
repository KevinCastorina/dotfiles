# Dotfiles

Best practices dotfiles repository for macOS, Arch-based Linux (CachyOS) and
Debian/Ubuntu, including Devcontainers.
Managed with [chezmoi](https://www.chezmoi.io/).

## Features

- **Cross-platform**: Works on macOS, Arch-based Linux (CachyOS, Arch, EndeavourOS, Manjaro) and Debian/Ubuntu, including Devcontainers.
- **Devcontainer Ready**: Designed to be installed automatically as containers spin up.
- **No Admin Required**: Homebrew is installed into `~/.linuxbrew` on Linux, so no `sudo` is ever needed.
- **One package manager**: Homebrew (bottles, no compilation) on every platform; pre-built binaries only as a fallback where Homebrew is unavailable.
- **Modern CLI Tools**: Includes configuration for `ripgrep`, `bat`, `eza`, `fzf`, `zoxide`, `fd`.
- **Shell**: `zsh`, `bash` and `fish` startup files are managed directly by chezmoi (no oh-my-zsh / oh-my-fish required).
- **Coding Agent**: [Pi-Bolt](https://github.com/opensec-git/Pi-Bolt) ahead-of-time compiled native Pi coding agent (`PI_OFFLINE=1`).

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

- `install.sh`: Bootstrapper script (installs chezmoi, applies dotfiles, backs up existing rc files). Safe to re-run.
- `.chezmoi.toml.tmpl`: Chezmoi configuration template.
- `.chezmoiignore`: Files in the repo that are never installed into `$HOME`.
- `.chezmoitemplates/shellrc.tmpl`: Shared shell configuration, rendered per shell.
- `dot_zshrc.tmpl` / `dot_bashrc.tmpl`: Managed `~/.zshrc` / `~/.bashrc` (Linux installs both).
- `dot_config/fish/config.fish`: Managed `~/.config/fish/config.fish` (see [fish](#fish)).
- `.chezmoiscripts/`: Scripts to run during `chezmoi apply` (install packages, setup tools).
- `dot_config/`: Configuration files for other tools.

## Re-running — installing what is missing

`./install.sh` and `chezmoi apply` are meant to be run as often as you like: each
installer script starts by checking whether the tool is already there
(`command -v`, `brew bundle`, the package directory), so a second run does nothing
but fetch what is still missing. A script that failed once (bad network, dead
download, formula error, unsupported CPU) prints the reason, does not abort the
apply, and is retried on the next run - nothing has to be deleted or reset first.

```bash
./install.sh                          # apply + install whatever is missing
./install.sh --config-only            # apply only, skip every package install
DOTFILES_SKIP_INSTALL=1 chezmoi apply # the same switch without install.sh
```

The install order is fixed by the file names (chezmoi runs `run_*_before_*` before
the target files and `run_*_after_*` after them, each group ordered by the rest of
the name), not by alphabetical luck:

| Script | Runs | Installs |
|------|------|------|
| `run_once_before_00-migrate-pi-agent-dir` | before files, once | move `~/.pi/agent` → `~/.config/pi/agent` |
| `run_before_10-install-brew-packages` | before files, every apply | Homebrew + everything in `~/.Brewfile` |
| `run_before_20-install-linux-binaries` | before files, every apply | pre-built binaries for what Homebrew did not provide (Linux) |
| `run_before_30-install-pi-bolt` | before files, every apply | Pi-Bolt (official installer) |
| `run_after_05-configure-vscode` | after files, every apply | VS Code settings symlink (macOS) |
| `run_after_99-health-check` | after files, every apply | reports what is still missing |

The `99-` prefix is what makes the health check run last, after everything that could
still have been installed. Outside CI a missing tool is a warning and the apply
succeeds; in CI the health check fails the run. Installer logs land in
`~/.cache/dotfiles/`: `pi-bolt-install.log`.

Only `00-migrate-pi-agent-dir` stays `run_once`: it moves a directory, so running it
again after a deliberate rollback would move things back.

## CachyOS / Arch-based (and other Linux)

On Linux the dotfiles use **Homebrew, installed into `~/.linuxbrew`** by
`.chezmoiscripts/run_before_10-install-brew-packages.sh.tmpl`. That is Homebrew's
official root-free install (`git clone` + symlink to `bin/brew`), so
`/home/linuxbrew` (root-owned) is deliberately avoided. `pacman` is *not* used
by the dotfiles - the system packages stay exactly as CachyOS ships them.

Bottles verified on CachyOS: `fish`, `ripgrep`, `bat`, `eza`, `fd`, `fzf`,
`zoxide` all pour from `*.x86_64_linux.bottle` - nothing
is compiled and no build toolchain is required.

```bash
./install.sh                          # installs Homebrew to ~/.linuxbrew if missing
DOTFILES_INSTALL_BREW=0 ./install.sh  # never install it; use ~/.local/bin binaries
```

Details:

- `brew` is looked up in `~/.linuxbrew`, `/home/linuxbrew/.linuxbrew`,
  `/opt/homebrew`, `/usr/local` - in that order, in the install scripts and in
  the managed `.bashrc` / `.zshrc` / `config.fish` (`brew shellenv`).
- Order is explicit: `10-install-brew-packages` runs before
  `20-install-linux-binaries`, and the latter only fetches tools that are still
  missing (it puts the Homebrew bin dirs on `PATH` to check). Both run on every
  apply, so `./install.sh` twice finishes a run that was interrupted.
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

## Pi-Bolt config location

Pi has no `XDG_CONFIG_HOME` support; the location of its user configuration is
set only by `PI_CODING_AGENT_DIR`. These dotfiles point it at
`~/.config/pi/agent` (bash, zsh and fish) and migrate an existing directory:

```
~/.config/pi/agent      config + state: settings.json, auth.json, models.json,
                        npm/ packages, sessions/
~/.pi/agent             symlink -> ~/.config/pi/agent (compatibility)
~/.pi-bolt              the installed release (pi-bin, pi-bolt-<os>-<arch>/)
```

The symlink is not cosmetic: pi-bolt writes into the agent dir at startup
(`trust.json.lock`, `settings.json.lock`), so any launcher that does not inherit
the variable (desktop app, `pi-bolt-remote-control` systemd unit, VS Code task,
cron) would otherwise silently create a second, empty `~/.pi/agent`.

`.chezmoiscripts/run_once_00-migrate-pi-agent-dir.sh.tmpl` does the move -
`mv`, never copy-over, and it refuses to merge when both directories exist
(it prints the two commands instead). The agent dir is deliberately **not**
managed by chezmoi: `settings.json` is machine-specific and `auth.json` holds API
keys (see the guards in `.chezmoiignore`). The release dir stays at `~/.pi-bolt`;
moving it would need `PIBOLT_INSTALL` / `PIBOLT_BIN_DIR` at install time.
Sessions stay inside the agent dir unless `PI_CODING_AGENT_SESSION_DIR` is set
(e.g. `~/.local/state/pi/sessions`).

To roll back: `rm ~/.pi/agent && mv ~/.config/pi/agent ~/.pi/agent`, then drop the
`export PI_CODING_AGENT_DIR` lines from the managed rc files.

### Forcing the one `run_once` script to run again

The install scripts run on every apply (see
[Re-running](#re-running--installing-what-is-missing)), so they never need
forcing. Only `run_once_*` scripts (the agent-dir move) are recorded in
`~/.config/chezmoi/chezmoistate.boltdb`. To run one again:

```bash
chezmoi state get-bucket --bucket=scriptState        # key -> {"name": "..."}
chezmoi state delete --bucket=scriptState --key=<key> && chezmoi apply
```

Installer output is kept in `~/.cache/dotfiles/`: `pi-bolt-install.log`.
