#!/bin/sh

# install.sh - Bootstrap script for dotfiles
# Installs chezmoi and applies dotfiles without root.

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

# 0. Check prerequisites
for cmd in curl git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log_error "Missing required dependency: $cmd"
    exit 1
  fi
done

# Backup an existing, unmanaged shell rc file before chezmoi applies its own.
# Files managed by chezmoi carry a "# ... managed by chezmoi" marker and are left alone.
backup_rc() {
  rc_path="$1"
  if [ -f "$HOME/$rc_path" ]; then
    if grep -q "managed by chezmoi" "$HOME/$rc_path" 2>/dev/null; then
      return 0
    fi
    log_warn "Found existing unmanaged $rc_path. Moving it to $rc_path.local..."
    mv -f "$HOME/$rc_path" "$HOME/$rc_path.local"
  fi
  return 0
}

# 1. Install chezmoi if not present
if ! command -v chezmoi >/dev/null 2>&1; then
  log_info "chezmoi not found. Installing to $BIN_DIR..."
  mkdir -p "$BIN_DIR"
  if sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$BIN_DIR"; then
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

if [ -f "$DOTFILES_DIR/install.sh" ]; then
  log_info "Applying dotfiles from $DOTFILES_DIR..."
  backup_rc ".zshrc"
  backup_rc ".bashrc"
  if chezmoi init --apply --source "$DOTFILES_DIR"; then
    log_success "Dotfiles applied successfully!"
  else
    log_error "Failed to apply dotfiles."
    exit 1
  fi
else
  log_error "Running in non-local mode (or script moved). Please clone the repo and run ./install.sh"
  exit 1
fi
