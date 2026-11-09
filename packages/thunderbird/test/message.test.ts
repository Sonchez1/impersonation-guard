// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { collectBodies, parseAuthor, parseHtmlBody, toMessage } from "../src/message";
import type { MessageHeader, MessagePart } from "../src/thunderbird";

describe("parseAuthor", () => {
  it("splits a display name and angle-bracketed address", () => {
    expect(parseAuthor("LinkedIn Support <li.support@gmail.com>")).toEqual({ name: "LinkedIn Support", address: "li.support@gmail.com" });
  });
  it("strips surrounding quotes from the name", () => {
    expect(parseAuthor('"Garcia, Luis" <luis@acmerobotics.com>')).toEqual({ name: "Garcia, Luis", address: "luis@acmerobotics.com" });
  });
  it("handles a bare address with no name", () => {
    expect(parseAuthor("no-reply@figma.com")).toEqual({ name: "", address: "no-reply@figma.com" });
  });
  it("returns empty fields for an empty author", () => {
    expect(parseAuthor("")).toEqual({ name: "", address: "" });
  });
});

describe("collectBodies", () => {
  it("gathers text/plain and text/html bodies from a nested MIME tree", () => {
    const part: MessagePart = {
      contentType: "multipart/mixed",
      parts: [
        {
          contentType: "multipart/alternative",
          parts: [
            { contentType: "text/plain", body: "plain here" },
            { contentType: "text/html; charset=utf-8", body: "<p>html here</p>" },
          ],
        },
        { contentType: "application/pdf", name: "resume.pdf" },
      ],
    };
    const { plain, html } = collectBodies(part);
    expect(plain).toEqual(["plain here"]);
    expect(html).toEqual(["<p>html here</p>"]);
  });
});

describe("parseHtmlBody", () => {
  it("extracts visible text and only http(s) links, de-duplicated", () => {
    const html = `<p>Verify your identity</p>
      <a href="https://linkedin-verify.app/login">here</a>
      <a href="mailto:x@y.com">mail</a>
      <a href="https://linkedin-verify.app/login">again</a>
      <a href="#frag">frag</a>`;
    const { text, links } = parseHtmlBody(html);
    expect(text).toContain("Verify your identity");
    expect(links).toEqual(["https://linkedin-verify.app/login"]);
  });
});

describe("toMessage", () => {
  const header: MessageHeader = { id: 7, author: "LinkedIn Support <li.support@gmail.com>", subject: "Action required" };

  it("prefers the text/plain body and merges html link hosts", () => {
    const full: MessagePart = {
      contentType: "multipart/alternative",
      parts: [
        { contentType: "text/plain", body: "This is the LinkedIn Security Team. Verify now." },
        { contentType: "text/html", body: `<a href="https://linkedin-verify.app/login">verify</a>` },
      ],
    };
    const msg = toMessage(header, full);
    expect(msg.senderName).toBe("LinkedIn Support");
    expect(msg.senderAddress).toBe("li.support@gmail.com");
    expect(msg.subject).toBe("Action required");
    expect(msg.body).toContain("LinkedIn Security Team");
    expect(msg.links).toEqual(["https://linkedin-verify.app/login"]);
  });

  it("falls back to html text when there is no plain part", () => {
    const full: MessagePart = { contentType: "text/html", body: "<p>Hello from the html body</p>" };
    const msg = toMessage(header, full);
    expect(msg.body).toContain("Hello from the html body");
  });
});
