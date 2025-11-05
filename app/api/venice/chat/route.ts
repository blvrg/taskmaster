import { NextRequest, NextResponse } from "next/server";
import {
	createChatCompletion,
	synthesizeSpeech,
	type VeniceMessage,
	type VeniceParameters,
} from "@/lib/venice";

export const runtime = "nodejs";

type ChatRequestBody = {
	messages: Array<{ role: VeniceMessage["role"]; content: string }>;
	veniceParameters?: VeniceParameters;
	voice?: {
		enabled: boolean;
	};
};

export async function POST(request: NextRequest) {
	try {
		const body = (await request.json()) as ChatRequestBody;

		if (!Array.isArray(body.messages) || body.messages.length === 0) {
			return NextResponse.json(
				{ error: "messages array is required" },
				{ status: 400 },
			);
		}

		const normalizedMessages: VeniceMessage[] = body.messages
			.slice(-20)
			.map((message) => ({
				role: message.role,
				content: message.content,
			}));

		const reply = await createChatCompletion({
			messages: normalizedMessages,
			parameters: body.veniceParameters,
		});

		if (body.voice?.enabled) {
			const audio = await synthesizeSpeech({ text: reply });
			return NextResponse.json({ reply, audio });
		}

		return NextResponse.json({ reply });
	} catch (error) {
		console.error("Venice chat error:", error);
		const message =
			error instanceof Error ? error.message : "Unexpected chat service error.";

		return NextResponse.json({ error: message }, { status: 500 });
	}
}
