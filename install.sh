#!/bin/sh

# install.sh - Bootstrap script for dotfiles
# Installs chezmoi and applies dotfiles without root.

set -e

# Define directories
BIN_DIR="$HOME/.local/bin"
export PATH="$BIN_DIR:$PATH"

# Function to log messages
log() {
  echo "=> $1"
}

# 1. Install chezmoi if not present
if ! command -v chezmoi >/dev/null 2>&1; then
  log "chezmoi not found. Installing to $BIN_DIR..."
  mkdir -p "$BIN_DIR"
  sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$BIN_DIR"
else
  log "chezmoi is already installed."
fi

# 2. Initialize and Apply
# If the script is run from the repo directory, use that as source.
# Otherwise, we might be running via curl.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOTFILES_DIR="$SCRIPT_DIR"

if [ -f "$DOTFILES_DIR/install.sh" ]; then
  log "Applying dotfiles from $DOTFILES_DIR..."
  chezmoi init --apply --source "$DOTFILES_DIR"
else
  # If running from curl (not local repo), we assume the user wants to clone.
  # However, for this task, the user likely clones first or uses devcontainers.
  # We will stick to local apply for now as per instructions "cloned into ~/.dotfiles" usually.
  log "Running in non-local mode (or script moved). Assuming standard chezmoi init..."
  # Replace USER/REPO with actual placeholders if needed, but for now we rely on local.
  echo "Error: Please clone the repo and run ./install.sh"
  exit 1
fi

log "Dotfiles applied successfully!"
