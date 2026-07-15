# Larkup Desktop

The desktop app for Larkup Studio.

## Prerequisites

Make sure you have installed:
* Node.js
* pnpm
* Rust and Cargo

For Mac users, install Xcode Command Line Tools first:
```bash
xcode-select --install
```

## Running locally

To start the app in development mode, simply run:
```bash
./dev.sh
```

## Building

To build the final installer for your operating system:
```bash
pnpm run build
```
The installer will be generated in the release folder.
