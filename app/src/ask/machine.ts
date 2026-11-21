export const ASK_STATES = ['idle', 'sent', 'received', 'answered', 'unreachable', 'failed'] as const;
export const ASK_EVENTS = ['submit', 'ack', 'answer', 'hub_error', 'ack_timeout', 'answer_timeout', 'retry', 'reset'] as const;
export type AskState = typeof ASK_STATES[number];
export type AskEvent = typeof ASK_EVENTS[number];

export const ASK_TABLE: Record<AskState, Record<AskEvent, AskState>> = {
  idle: { submit: 'sent', ack: 'idle', answer: 'idle', hub_error: 'idle', ack_timeout: 'idle', answer_timeout: 'idle', retry: 'idle', reset: 'idle' },
  sent: { submit: 'sent', ack: 'received', answer: 'answered', hub_error: 'failed', ack_timeout: 'unreachable', answer_timeout: 'sent', retry: 'sent', reset: 'sent' },
  received: { submit: 'received', ack: 'received', answer: 'answered', hub_error: 'failed', ack_timeout: 'received', answer_timeout: 'failed', retry: 'received', reset: 'received' },
  answered: { submit: 'answered', ack: 'answered', answer: 'answered', hub_error: 'answered', ack_timeout: 'answered', answer_timeout: 'answered', retry: 'answered', reset: 'idle' },
  unreachable: { submit: 'unreachable', ack: 'received', answer: 'answered', hub_error: 'unreachable', ack_timeout: 'unreachable', answer_timeout: 'unreachable', retry: 'sent', reset: 'idle' },
  failed: { submit: 'failed', ack: 'failed', answer: 'answered', hub_error: 'failed', ack_timeout: 'failed', answer_timeout: 'failed', retry: 'sent', reset: 'idle' },
};

export function askReducer(state: AskState, event: AskEvent): AskState {
  return ASK_TABLE[state][event];
}
