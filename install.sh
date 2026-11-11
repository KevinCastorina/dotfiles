#!/bin/sh

# install.sh - Bootstrap script for dotfiles
# Installs chezmoi and applies dotfiles without root.
#
# Safe to run as often as you like: every apply only installs what is still
# missing (the .chezmoiscripts installers check for each tool before fetching it),
# so re-running it after a failed or half-finished run retries exactly the
# packages that did not make it. Nothing here wipes an existing install.
#
# Options / environment:
#   --config-only           apply the dotfiles, skip every package install
#   DOTFILES_SKIP_INSTALL=1 same, without an option
#   DOTFILES_INSTALL_BREW=0 never install Homebrew on Linux (use ~/.local/bin)
#   DOTFILES_DEFAULT_SHELL=fish  also chsh to fish at the end

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RESET='\033[0m'

# Define directories
BIN_DIR="$HOME/.local/bin"
export PATH="$BIN_DIR:$PATH"

# Logging functions (using printf for POSIX compliance)
log_info() {
  printf "${BLUE}ℹ️  %s${RESET}\n" "$1"
}

log_success() {
  printf "${GREEN}✅ %s${RESET}\n" "$1"
}

log_warn() {
  printf "${YELLOW}⚠️  %s${RESET}\n" "$1"
}

log_error() {
  printf "${RED}❌ %s${RESET}\n" "$1"
}

# Options (the chezmoi scripts read these from the environment).
usage() {
  cat <<'EOF'
install.sh - bootstrap the dotfiles, without root.

Safe to run as often as you like: every apply installs only what is still
missing, so re-running retries exactly the packages that did not make it.

Options:
  --config-only   apply the dotfiles, skip every package install

Environment (also work without an option):
  DOTFILES_SKIP_INSTALL=1     same as --config-only
  DOTFILES_INSTALL_BREW=0     Linux: never install Homebrew, use ~/.local/bin
  DOTFILES_DEFAULT_SHELL=fish also chsh to fish at the end
  CI=1                        non-interactive: overwrite changed files, strict
EOF
}

for arg in "$@"; do
  case "$arg" in
    --config-only)
      DOTFILES_SKIP_INSTALL=1
      export DOTFILES_SKIP_INSTALL
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_warn "Ignoring unknown argument: $arg"
      ;;
  esac
done

# 0. Check prerequisites. These are the only things the script cannot fetch for
#    itself, so say how to get them and that re-running continues where it stops.
for cmd in curl git tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Missing required dependency: $cmd (install it with your package manager, then run ./install.sh again)"
    exit 1
  fi
done

# Backup an existing, unmanaged shell rc file before chezmoi applies its own.
# The managed versions source the backup (.zshrc.local, .bashrc.local,
# config.local.fish), so local settings survive the switch.
# Files managed by chezmoi carry a "# ... managed by chezmoi" marker and are left alone.
backup_rc() {
  rc_path="$1"
  backup_path="${2:-$1.local}"
  if [ -f "$HOME/$rc_path" ]; then
    if grep -q "managed by chezmoi" "$HOME/$rc_path" 2>/dev/null; then
      return 0
    fi
    log_warn "Found existing unmanaged $rc_path. Moving it to $backup_path..."
    mkdir -p "$(dirname "$HOME/$backup_path")"
    mv -f "$HOME/$rc_path" "$HOME/$backup_path"
  fi
  return 0
}

# 1. Install chezmoi if not present
if ! command -v chezmoi >/dev/null 2>&1; then
  log_info "chezmoi not found. Installing to $BIN_DIR..."
  mkdir -p "$BIN_DIR"
  if sh -c "$(curl -fsLS --retry 3 --retry-delay 2 get.chezmoi.io)" -- -b "$BIN_DIR"; then
      log_success "chezmoi installed successfully."
  else
      log_error "Failed to install chezmoi."
      exit 1
  fi
else
  log_success "chezmoi is already installed."
fi

# 2. Initialize and Apply
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOTFILES_DIR="$SCRIPT_DIR"

if [ ! -f "$DOTFILES_DIR/install.sh" ]; then
  if [ -f "$HOME/.dotfiles/install.sh" ]; then
    DOTFILES_DIR="$HOME/.dotfiles"
  fi
fi

if [ -f "$DOTFILES_DIR/install.sh" ]; then
  log_info "Applying dotfiles from $DOTFILES_DIR..."
  backup_rc ".zshrc"
  backup_rc ".bashrc"
  backup_rc ".config/fish/config.fish" ".config/fish/config.local.fish"
  set -- init --apply --source "$DOTFILES_DIR"
  # Without a terminal chezmoi cannot ask about files that changed since it last wrote them
  # and would abort, so overwrite them in CI / non-interactive runs (e.g. devcontainer setup).
  if [ -n "${CI:-}" ] || [ ! -t 0 ]; then
    set -- "$@" --force
  fi
  if [ "${DOTFILES_SKIP_INSTALL:-0}" = "1" ]; then
    log_info "Package installs skipped (DOTFILES_SKIP_INSTALL=1 / --config-only)."
  fi

  if chezmoi "$@"; then
    log_success "Dotfiles applied successfully!"
  else
    log_error "Failed to apply dotfiles."
    log_info "Re-run ./install.sh - whatever installed so far is kept, the rest is retried."
    log_info "See ~/.cache/dotfiles/ for the installer logs."
    exit 1
  fi

  # Optional: make fish the login shell (DOTFILES_DEFAULT_SHELL=fish ./install.sh).
  # chsh asks for the password on /dev/tty itself, so only do it when a terminal exists.
  if [ "${DOTFILES_DEFAULT_SHELL:-}" = "fish" ] && ( : < /dev/tty ) 2>/dev/null; then
    if command -v fish >/dev/null 2>&1; then
      fish_path="$(command -v fish)"
      if [ "$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7)" = "$fish_path" ]; then
        log_success "Login shell already is $fish_path."
      elif grep -qx "$fish_path" /etc/shells 2>/dev/null; then
        log_info "Setting login shell to $fish_path (may ask for your password)..."
        if chsh -s "$fish_path"; then
          log_success "Login shell set to fish."
        else
          log_warn "chsh failed; run 'chsh -s $fish_path' manually."
        fi
      else
        log_warn "$fish_path is not listed in /etc/shells; add it, then run 'chsh -s $fish_path'."
      fi
    else
      log_warn "fish is not installed; leaving the login shell unchanged."
    fi
  fi
else
  log_error "Running in non-local mode (or script moved). Please clone the repo and run ./install.sh"
  exit 1
fi
