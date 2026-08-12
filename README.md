# Dotfiles

Best practices dotfiles repository for macOS, Unix, and Devcontainers (Debian).
Managed with [chezmoi](https://www.chezmoi.io/).

## Features

- **Cross-platform**: Works on macOS and Linux (Debian/Ubuntu).
- **Devcontainer Ready**: Designed to be installed automatically as containers spin up.
- **No Admin Required**: optimized for environments without `sudo` access (corporate workstations, restricted containers).
- **Modern CLI Tools**: Includes configuration for `ripgrep`, `bat`, `eza`, `fzf`, `zoxide`, `fd`.
- **Shell**: `zsh` and `bash` startup files are managed directly by chezmoi (no oh-my-zsh required).
- **Coding Agent**: `omp` (Oh My Pi) terminal coding agent.

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
