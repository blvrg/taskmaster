const VENICE_BASE_URL = "https://api.venice.ai/api/v1";

type VeniceRequestInit = Omit<RequestInit, "headers"> & {
	headers?: Record<string, string>;
};

const DEFAULT_CHAT_MODEL = process.env.VENICE_CHAT_MODEL ?? "venice-uncensored";
const DEFAULT_IMAGE_MODEL = process.env.VENICE_IMAGE_MODEL ?? "hidream";
const DEFAULT_TTS_MODEL = process.env.VENICE_TTS_MODEL ?? "tts-kokoro";
const DEFAULT_TTS_VOICE = process.env.VENICE_TTS_VOICE ?? "af_heart";

function requireApiKey(): string {
	const apiKey = process.env.VENICE_API_KEY;
	if (!apiKey) {
		throw new Error(
			"Missing VENICE_API_KEY. Add it to your environment before using Venice endpoints.",
		);
	}
	return apiKey;
}

async function veniceFetch<T = unknown>(
	path: string,
	init: VeniceRequestInit,
): Promise<T> {
	const apiKey = requireApiKey();
	const response = await fetch(`${VENICE_BASE_URL}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			...init.headers,
		},
	});

	if (!response.ok) {
		let errorMessage = `Venice request failed with status ${response.status}`;
		try {
			const errorData = await response.json();
			if (errorData?.error) {
				errorMessage = Array.isArray(errorData.error)
					? errorData.error.join(", ")
					: String(errorData.error);
			}
		} catch {
			// Ignore JSON parse errors, keep default message.
		}
		throw new Error(errorMessage);
	}

	if (
		response.headers
			.get("content-type")
			?.toLowerCase()
			.includes("application/json")
	) {
		return (await response.json()) as T;
	}

	const arrayBuffer = await response.arrayBuffer();
	return Buffer.from(arrayBuffer) as T;
}

export type VeniceMessage = {
	role: "system" | "user" | "assistant";
	content:
		| string
		| Array<
				| { type: "text"; text: string }
				| {
						type: "image_url";
						image_url: { url: string };
				  }
		  >;
};

export type VeniceParameters = Record<string, string | number | boolean>;

export async function createChatCompletion({
	messages,
	parameters,
	model = DEFAULT_CHAT_MODEL,
	maxTokens = 1000,
	temperature = 1,
	topP = 0.1,
}: {
	messages: VeniceMessage[];
	parameters?: VeniceParameters;
	model?: string;
	maxTokens?: number;
	temperature?: number;
	topP?: number;
}): Promise<string> {
	const data = await veniceFetch<{
		choices: Array<{ message: { content: string } }>;
	}>("/chat/completions", {
		method: "POST",
		body: JSON.stringify({
			model,
			messages,
			venice_parameters: parameters,
			frequency_penalty: 0,
			presence_penalty: 0,
			max_tokens: maxTokens,
			max_completion_tokens: Math.max(1, maxTokens - 2),
			temperature,
			top_p: topP,
			stream: false,
		}),
	});

	const choice = data.choices?.[0]?.message?.content;
	if (!choice) {
		throw new Error("Venice returned an empty response.");
	}

	return choice;
}

export async function describeImage({
	imageBase64,
	maxTokens = 200,
	temperature = 0.3,
}: {
	imageBase64: string;
	maxTokens?: number;
	temperature?: number;
}): Promise<string> {
	return createChatCompletion({
		messages: [
			{
				role: "system",
				content:
					"You are a helpful assistant that describes images in detail.",
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "Describe this image in vivid detail, focusing on the main subject, setting, colors, and notable features.",
					},
					{
						type: "image_url",
						image_url: {
							url: `data:image/webp;base64,${imageBase64}`,
						},
					},
				],
			},
		],
		model: process.env.VENICE_VISION_MODEL ?? "mistral-31-24b",
		maxTokens,
		temperature,
	});
}

export async function generateImage({
	prompt,
	model = DEFAULT_IMAGE_MODEL,
	width = 1024,
	height = 1024,
	steps = 20,
	cfgScale = 7.5,
	format = "webp",
	variants = 1,
	safeMode = false,
}: {
	prompt: string;
	model?: string;
	width?: number;
	height?: number;
	steps?: number;
	cfgScale?: number;
	format?: "webp" | "png" | "jpg";
	variants?: number;
	safeMode?: boolean;
}): Promise<string> {
	const data = await veniceFetch<{ images: string[] }>("/image/generate", {
		method: "POST",
		body: JSON.stringify({
			model,
			prompt,
			width,
			height,
			steps,
			cfg_scale: cfgScale,
			format,
			variants,
			safe_mode: safeMode,
		}),
	});

	const image = data.images?.[0];
	if (!image) {
		throw new Error("Venice image generation returned no images.");
	}

	return image;
}

export async function editImage({
	prompt,
	imageUrl,
	model = DEFAULT_IMAGE_MODEL,
	format = "webp",
}: {
	prompt: string;
	imageUrl: string;
	model?: string;
	format?: "webp" | "png" | "jpg";
}): Promise<string> {
	const data = await veniceFetch<{ images: string[] }>("/image/edit", {
		method: "POST",
		body: JSON.stringify({
			prompt,
			image: imageUrl,
			model,
			format,
		}),
	});

	const image = data.images?.[0];
	if (!image) {
		throw new Error("Venice image edit returned no images.");
	}

	return image;
}

export async function synthesizeSpeech({
	text,
	model = DEFAULT_TTS_MODEL,
	voice = DEFAULT_TTS_VOICE,
	responseFormat = "mp3",
	speed = 1,
}: {
	text: string;
	model?: string;
	voice?: string;
	responseFormat?: "mp3" | "wav" | "ogg";
	speed?: number;
}): Promise<{ base64: string; mimeType: string }> {
	const result = await veniceFetch<Buffer>("/audio/speech", {
		method: "POST",
		body: JSON.stringify({
			input: text,
			model,
			voice,
			response_format: responseFormat,
			speed,
			streaming: false,
		}),
	});

	const mimeType =
		responseFormat === "wav"
			? "audio/wav"
			: responseFormat === "ogg"
				? "audio/ogg"
				: "audio/mpeg";

	return {
		base64: result.toString("base64"),
		mimeType,
	};
}
import { Buffer } from "node:buffer";
