/** Minimal typings for the subset of the Thunderbird MailExtension (WebExtension) API this
 *  add-on uses. The full types live in `thunderbird-webext-browser`; we declare only what we
 *  call so the package builds without that dependency. Runtime shapes are from the official
 *  WebExtension API docs (webextension-api.thunderbird.net). */

/** One MIME part of a message, as returned by messages.getFull(). */
export interface MessagePart {
  contentType?: string;
  /** Decoded text content; present only for text/* parts. */
  body?: string;
  parts?: MessagePart[];
  headers?: Record<string, string[]>;
  name?: string;
  partName?: string;
}

/** A message in a folder; `author` is a "Name <address>" string, `id` an internal integer. */
export interface MessageHeader {
  id: number;
  author: string;
  subject: string;
  recipients?: string[];
}

export interface MessageList {
  id: string | null;
  messages: MessageHeader[];
}

export interface MessageSender {
  tab?: { id?: number };
}

declare global {
  const messenger: {
    runtime: {
      onMessage: {
        addListener(
          cb: (
            message: unknown,
            sender: MessageSender,
            sendResponse: (response?: unknown) => void,
          ) => boolean | void | Promise<unknown>,
        ): void;
      };
      onInstalled: { addListener(cb: () => void | Promise<void>): void };
      sendMessage(message: unknown): Promise<unknown>;
    };
    storage: {
      local: {
        get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
      };
    };
    messageDisplay: {
      getDisplayedMessages(tabId?: number): Promise<MessageList | MessageHeader[]>;
    };
    messages: {
      getFull(
        messageId: number,
        options?: { decodeContent?: boolean; decodeHeaders?: boolean; decrypt?: boolean },
      ): Promise<MessagePart>;
    };
    messageDisplayScripts: {
      register(options: {
        js?: ({ file: string } | { code: string })[];
        css?: ({ file: string } | { code: string })[];
        runAt?: "document_start" | "document_end" | "document_idle";
      }): Promise<{ unregister?: () => Promise<void> }>;
    };
  };
}

export {};
