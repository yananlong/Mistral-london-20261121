# Offline answer hub

The Mac runs a BitChat peer named `hub`. It answers incoming mesh private messages using Ollama on the DGX Spark over the local link. The phone gets an acknowledgement and then a labelled answer; no internet model service is used.

## Spark

While online, install Ollama, then bind it to the Spark's **local-link** address and pre-pull the model:

```sh
hub/spark/setup-ollama.sh --dry-run 10.0.0.2
hub/spark/setup-ollama.sh --pull 10.0.0.2
```

The script installs a systemd drop-in, restarts Ollama, and checks the model is present. Omit `--pull` for repeat setup or offline checks. Disconnect the internet and verify again with `OLLAMA_HOST=10.0.0.2:11434 ollama list`. On the Spark, record a test and its time:

```sh
OLLAMA_URL=http://10.0.0.2:11434 hub/spark/smoke.sh answer-times.tsv
```

The TSV has UTC time, model tag, seconds, and answer length. Override `OLLAMA_MODEL` if using another tag.

## Mac

Open the BitChat fork in Xcode, select the macOS scheme, and in **Edit Scheme → Run → Arguments → Environment Variables** set:

```text
BITCHAT_HUB=1
BITCHAT_HUB_OLLAMA_URL=http://10.0.0.2:11434
BITCHAT_HUB_MODEL=ministral-3:14b-instruct-2512-q4_K_M
```

The URL and model variables are optional; defaults are `http://127.0.0.1:11434` and the tag above. Run the app with Bluetooth enabled. Incoming private questions get replies through BitChat's normal encrypted send path. The console logs one line per question with outcome and latency, without the question text.

Before starting BitChat, check the local link from the Mac:

```sh
hub/cli/build.sh
hub/cli/.build/hub-ask --url http://10.0.0.2:11434 'How can I make water safe to drink?'
# Optional: --model TAG, --loc 51.50070,-0.12460, or pipe the question on stdin.
```

Run the local protocol, responder, and fake-Ollama tests with `hub/tests/run.sh`. The scripts invoke `swiftc` directly. If Command Line Tools contains duplicate SwiftBridging module maps, `hub/swiftc.sh` uses a temporary compiler overlay without modifying the installation.

This machine has no Xcode, so the BitChat app has not been built or run, and the Bluetooth/Noise round trip and the sandbox's local HTTP access have not been verified. The Spark, real model, and offline phone-to-hub demo also still need a live check.
