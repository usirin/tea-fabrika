// The built-in Send command, next/ (P41 slice 1): a program asks the host to mail JSON to a
// registered name. Its only operands are the name and the message; the runner binds who sends it.
// `queued` means the letter is saved and its recipient scheduled, never that it was answered.
import { Cmd } from "@demlik/tea/effect";
import { Schema } from "effect";
import { MailRefusal } from "../processes/ProgramMail.ts";

export const SendInput = Schema.Struct({ to: Schema.NonEmptyString, m: Schema.Json });

/** The delivery receipt: the saved letter's ID. */
export const Queued = Schema.TaggedStruct("queued", { id: Schema.NonEmptyString });

/** The runner performs it itself; a caller-supplied handler never runs it. */
export const send = Cmd.make("send", { input: SendInput, ok: Queued, err: MailRefusal.literals });
