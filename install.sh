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
