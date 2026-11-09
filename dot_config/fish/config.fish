# ~/.config/fish/config.fish (managed by chezmoi)
# Fish port of .chezmoitemplates/shellrc.tmpl: same PATH, editor, modern CLI
# aliases and tool integrations as the managed ~/.bashrc / ~/.zshrc.
#
# Local / work overrides belong in ~/.config/fish/config.local.fish, which
# ./install.sh creates by moving a pre-existing (unmanaged) config.fish there.

# =============================================================================
# Load Local/Work Configuration (Pre-Dotfiles)
# =============================================================================
# Sourced first so the managed settings below win, same order as bash/zsh.
if test -f ~/.config/fish/config.local.fish
    source ~/.config/fish/config.local.fish
end

# =============================================================================
# CachyOS / Arch system defaults
# =============================================================================
# CachyOS ships its own fish setup (fastfetch greeting, eza aliases, bang-bang
# history bindings, `done` notifications) in /usr/share and points the stock
# ~/.config/fish/config.fish at it. Keep it: it is not managed by chezmoi, and
# the managed aliases below still take precedence. /etc/fish/config.fish is
# loaded by fish itself, so plain Arch needs nothing here.
if test -f /usr/share/cachyos-fish-config/cachyos-config.fish
    source /usr/share/cachyos-fish-config/cachyos-config.fish
end

# =============================================================================
# Path Configuration
# =============================================================================

# User local bin (Pi-Bolt, chezmoi, pre-built tools)
fish_add_path ~/.local/bin

# Homebrew setup (macOS and Linuxbrew) - only when a brew binary exists.
# ~/.linuxbrew comes first: that is the root-free prefix the dotfiles install
# into; /home/linuxbrew is Homebrew's default prefix and needs root.
for brew_path in $HOME/.linuxbrew/bin/brew \
                 /home/linuxbrew/.linuxbrew/bin/brew \
                 /opt/homebrew/bin/brew \
                 /usr/local/bin/brew
    if test -x $brew_path
        # "fish" is required: without it brew prints sh syntax, which fish
        # cannot parse.
        eval ($brew_path shellenv fish)
        break
    end
end

# Quieter, faster Homebrew
set -gx HOMEBREW_NO_ANALYTICS 1
set -gx HOMEBREW_NO_ENV_HINTS 1

# =============================================================================
# Editor Configuration
# =============================================================================

set -gx EDITOR vim
if type -q code
    set -gx EDITOR code
end

# =============================================================================
# Pi-Bolt
# =============================================================================
# Disable startup network operations (update checks, model catalog refresh)
set -gx PI_OFFLINE 1

# Keep configuration and state under XDG (~/.config/pi/agent) instead of ~/.pi/agent.
# A compatibility symlink ~/.pi/agent -> ~/.config/pi/agent is left in place by
# .chezmoiscripts/run_once_00-migrate-pi-agent-dir.sh, so launchers that do not
# inherit this variable still read the same files.
set -gx PI_CODING_AGENT_DIR "$HOME/.config/pi/agent"

# =============================================================================
# Interactive Configuration
# =============================================================================
# Aliases, key bindings and completions are only useful in interactive shells,
# and skipping them keeps `fish -c ...` / script shebangs fast.
if status is-interactive

    # --- Modern CLI replacements ---------------------------------------------

    # bat - cat replacement with syntax highlighting
    if type -q bat
        alias cat='bat'
    end

    # eza - ls replacement
    # Icons are enabled only if a Nerd Font is detected via DOTFILES_ICONS=1
    if type -q eza
        if test "$DOTFILES_ICONS" = 1
            alias ls='eza --icons --group-directories-first'
            alias ll='eza -l --icons --group-directories-first'
            alias la='eza -la --icons --group-directories-first'
        else
            alias ls='eza --group-directories-first'
            alias ll='eza -l --group-directories-first'
            alias la='eza -la --group-directories-first'
        end
    end

    # ripgrep - grep replacement
    if type -q rg
        alias grep='rg'
    end

    # --- Tool integrations ---------------------------------------------------

    # zoxide - smarter cd
    if type -q zoxide
        zoxide init fish --cmd cd | source
    end

    # fzf - fuzzy finder (key bindings + completion); needs fzf >= 0.48
    if type -q fzf
        fzf --fish 2>/dev/null | source
    end

    # The prompt is fish's default: abbreviated working directory plus git
    # status/branch, which matches the "~ (branch) ➜" prompt of bash/zsh.

end

# =============================================================================
# User Configuration
# =============================================================================
# Add your custom configurations below this line (or use config.local.fish,
# which survives a re-apply of the dotfiles).
