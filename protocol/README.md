# Message contract

This is the contract between the phone app and the hub, and between two phones. Every message is a plain-text BitChat message in UTF-8, so a person with stock BitChat can still talk to the hub. [BLUEPRINT_1.md](../BLUEPRINT_1.md#message-format) has the reasoning. This file pins the exact strings, limits and states.

`make_vectors.py` is the reference implementation. It writes `vectors.json`, and both the app's tests (TypeScript) and the hub's tests (Swift) read that file. To change the contract, edit `make_vectors.py` and this file together, run `python3 protocol/make_vectors.py`, and fix both test suites.

## Constants

| Name | Value |
| --- | --- |
| `HUB_NICKNAME` | `hub` |
| `ACK_TEXT` | `Received. Working on an answer.` |
| `ANSWER_LABEL` | `AI answer from an open-weight model on the hub. Not verified emergency advice.` |
| `HUB_ERROR_TEXT` | `The hub could not answer right now. Please try again.` |
| `HUB_EMPTY_TEXT` | `Send a question in plain words, for example: How do I make water safe to drink?` |
| `LOCATION_SHARE_DEFAULT_NOTE` | `Shared location` |
| `MAX_QUESTION_UNITS` | 500 |
| `MAX_ANSWER_BODY_UNITS` | 900 |
| `ACK_TIMEOUT_MS` (phone) | 30000 |
| `ANSWER_TIMEOUT_MS` (phone, counted from the ack) | 150000 |
| `HUB_MODEL_TIMEOUT_MS` (hub) | 120000 |

Lengths count UTF-16 code units (`string.length` in JavaScript, `string.utf16.count` in Swift). Truncation never splits a character. Before parsing, both sides turn `\r\n` and `\r` into `\n`. "Trim" means removing leading and trailing whitespace and newlines.

## The `loc:` line

- **Encode.** `loc: <lat>,<lon>`, each number with exactly 5 decimals, for example `loc: 51.50070,-0.12460`.
- **Decode.** The trimmed line must match `^loc:\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$`, with latitude in [-90, 90] and longitude in [-180, 180]. Anything else is not a `loc:` line. The prefix is lowercase only.
- Only the last non-empty line of a message can be a `loc:` line. A `loc:` line anywhere else is ordinary text.

## Ask: phone to hub

1. **Question.** The phone sends a private message to the peer whose nickname is `HUB_NICKNAME`: the trimmed question, then `\n` and a `loc:` line if the person chose to attach their location.
2. **Ack.** The hub replies `ACK_TEXT` at once, before the model runs.
3. **Answer.** The hub replies with the answer body, then `\n`, then `ANSWER_LABEL`. If the model fails, times out after `HUB_MODEL_TIMEOUT_MS` or returns nothing, the hub sends `HUB_ERROR_TEXT` instead.

The phone has only one question in flight to the hub at a time, and the hub handles one sender's questions one at a time in arrival order. So the next ack or answer from the hub belongs to the question in flight. Plain BitChat text has no question id, and this rule replaces one.

### What the hub does with a private message

- **Parse.** Remove a trailing `loc:` line, then trim the rest. If the rest is empty, reply `HUB_EMPTY_TEXT` and stop, with no ack and no model run. Otherwise cut the question to `MAX_QUESTION_UNITS`.
- **Prompt.** The user message to the model is the question. If there is a location, append `\n\nThe person's approximate location: <lat>, <lon> (London, UK).` with 5 decimals. `vectors.json` → `userContent` has the exact strings.
- **Compose the answer.** Drop any line of the model output that equals `ANSWER_LABEL` after trimming, then trim the result. If it is empty, send `HUB_ERROR_TEXT`. If it is longer than `MAX_ANSWER_BODY_UNITS`, cut it to `MAX_ANSWER_BODY_UNITS - 1` units, then back to the last `\n` if that leaves at least half the limit, otherwise back to the last space if that leaves at least half, then trim the end and append `…` (U+2026). Then append `\n` and `ANSWER_LABEL`.
- **Ignore** public messages, the hub's own messages, and messages from peers other than the sender being answered.

### How the phone reads a reply from the hub

Trim the reply, then:

| Reply | Kind |
| --- | --- |
| equals `ACK_TEXT` | `ack` |
| equals `HUB_ERROR_TEXT` | `hub_error` |
| last line, trimmed, equals `ANSWER_LABEL` | `answer`, whose body is everything before that line, trimmed |
| anything else | `other`, which the Ask screen ignores and the Talk screen shows as a normal message |

### Ask states

| State | Shown as | Entered when |
| --- | --- | --- |
| `idle` | the question composer | the screen opens, or after `reset` |
| `sent` | **Sent** | the phone has sent the question into the mesh. Starts the `ACK_TIMEOUT_MS` timer. |
| `received` | **Received by hub** | the ack arrived. Starts the `ANSWER_TIMEOUT_MS` timer. |
| `answered` | **Answered** | the answer arrived |
| `unreachable` | **Hub not reachable** | no ack within `ACK_TIMEOUT_MS`. The person can retry. |
| `failed` | **Hub could not answer** | the hub sent `HUB_ERROR_TEXT`, or no answer came within `ANSWER_TIMEOUT_MS` of the ack. The person can retry. |

Transitions. Every (state, event) pair not listed leaves the state unchanged. `vectors.json` → `askTransitions` has the full 6 × 8 table.

| From | Event | To |
| --- | --- | --- |
| `idle` | `submit` | `sent` |
| `sent` | `ack` | `received` |
| `sent` | `answer` | `answered` (the ack was lost, but the answer counts) |
| `sent` | `hub_error` | `failed` |
| `sent` | `ack_timeout` | `unreachable` |
| `received` | `answer` | `answered` |
| `received` | `hub_error` | `failed` |
| `received` | `answer_timeout` | `failed` |
| `unreachable` | `ack` | `received` (a late ack) |
| `unreachable` | `answer` | `answered` (a late answer) |
| `unreachable`, `failed` | `retry` | `sent`, which sends the same question again |
| `failed` | `answer` | `answered` (a late answer) |
| `answered`, `unreachable`, `failed` | `reset` | `idle` |

The phone sends only after it has seen the hub. It remembers the hub's peer id, and when the hub drops out of range it still sends to that id, so the person sees **Hub not reachable** rather than a disabled button. Before the phone has ever seen the hub, the Ask screen says it is looking for the hub.

A retry can leave a duplicate ack or answer in the mesh. The first one wins and the state table ignores the rest. A stale answer that arrives after `reset` and a new `submit` is attributed to the new question. That is a known limit of plain text with no question id.

## Location share: phone to phone

A location share is a public or private message whose last line is a `loc:` line. The text before it is the note, which defaults to `LOCATION_SHARE_DEFAULT_NOTE`. The receiving phone shows a pin for the sender at that position, keeping only the latest share from each sender. The app never sends a location share to the hub.

## Native mesh module API

The app talks to the mesh only through its `Transport` interface. On iPhone, the `BitchatMesh` Expo module in `app/modules/bitchat-mesh/` implements it on top of the BitChat fork. Its JavaScript surface:

```ts
type NativePeer = { id: string; nickname: string; reachable: boolean };
type NativeMessage = {
  id: string;
  from: string;          // sender peer id
  fromNickname: string;
  text: string;
  channel: 'public' | 'private';
  receivedAt: number;    // ms since epoch
};
type NativeLinkState = 'starting' | 'running' | 'bluetooth_off' | 'unauthorized' | 'unsupported' | 'stopped';

// Functions
start(nickname: string): Promise<void>;
stop(): Promise<void>;
getPeers(): Promise<NativePeer[]>;
sendPublic(text: string): Promise<void>;
sendPrivate(peerId: string, text: string): Promise<void>;

// Events
onPeers:   { peers: NativePeer[] }       // the full current list, on every change
onMessage: NativeMessage                 // inbound only, never the phone's own messages
onState:   { state: NativeLinkState; detail?: string }
```
