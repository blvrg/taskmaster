import { NextRequest, NextResponse } from "next/server";
import {
	describeImage,
	editImage,
	generateImage,
	type VeniceParameters,
} from "@/lib/venice";

export const runtime = "nodejs";

type ImageRequestBody = {
	prompt: string;
	mode?: "generate" | "edit";
	imageUrl?: string;
	veniceParameters?: VeniceParameters;
};

export async function POST(request: NextRequest) {
	try {
		const body = (await request.json()) as ImageRequestBody;

		if (!body.prompt || typeof body.prompt !== "string") {
			return NextResponse.json({ error: "prompt is required" }, { status: 400 });
		}

		let imageBase64: string;
		if (body.mode === "edit") {
			if (!body.imageUrl) {
				return NextResponse.json(
					{ error: "imageUrl is required for edit mode" },
					{ status: 400 },
				);
			}
			imageBase64 = await editImage({
				prompt: body.prompt,
				imageUrl: body.imageUrl,
			});
		} else {
			imageBase64 = await generateImage({ prompt: body.prompt });
		}

		let description: string | null = null;
		try {
			description = await describeImage({ imageBase64 });
		} catch (describeError) {
			console.warn("Image description failed:", describeError);
		}

		return NextResponse.json({
			imageBase64,
			description,
		});
	} catch (error) {
		console.error("Venice image error:", error);
		const message =
			error instanceof Error ? error.message : "Unexpected image service error.";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
