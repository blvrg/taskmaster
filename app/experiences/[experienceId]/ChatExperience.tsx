"use client";

import { useCallback, useMemo, useState } from "react";
import styles from "./ChatExperience.module.css";

type ChatExperienceProps = {
	character: {
		slug?: string;
		name?: string;
		photoUrl?: string;
	};
	experienceName: string;
	userDisplayName: string;
};

type ChatMessage =
	| {
			id: string;
			role: "user" | "assistant";
			type: "text";
			content: string;
	  }
	| {
			id: string;
			role: "assistant";
			type: "image";
			imageBase64: string;
			description?: string;
	  }
	| {
			id: string;
			role: "assistant";
			type: "audio";
			audioBase64: string;
			mimeType: string;
			text: string;
	  };

type VeniceParametersPayload = Record<string, string | number | boolean>;

function cx(...classes: Array<string | false | null | undefined>): string {
	return classes.filter(Boolean).join(" ");
}

function randomId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2);
}

export function ChatExperience({
	character,
	experienceName,
	userDisplayName,
}: ChatExperienceProps) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [isImageMode, setIsImageMode] = useState(false);
	const [isVoiceMode, setIsVoiceMode] = useState(false);
	const [isEditMode, setIsEditMode] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [pendingIndicator, setPendingIndicator] = useState<
		"image" | "text" | null
	>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const displayName = character.name?.trim() || "Venice AI";
	const canEditImage = Boolean(
		character.photoUrl && character.photoUrl.trim().length > 0,
	);

	const historyForCompletion = useMemo(
		() =>
			messages
				.filter(
					(message): message is Extract<ChatMessage, { type: "text" }> =>
						message.type === "text",
				)
				.slice(-20)
				.map((message) => ({
					role: message.role,
					content: message.content,
				})),
		[messages],
	);

	const veniceParameters = useMemo(() => {
		const params: VeniceParametersPayload = {
			enable_web_search: "auto",
			include_venice_system_prompt: true,
		};

		if (character.slug) {
			params.character_slug = character.slug;
		}

		return params;
	}, [character.slug]);

	const handleToggleImageMode = useCallback(() => {
		setErrorMessage(null);
		setIsImageMode((prev) => {
			const next = !prev;
			if (next) {
				setIsVoiceMode(false);
				setIsEditMode(false);
			}
			return next;
		});
	}, []);

	const handleToggleVoiceMode = useCallback(() => {
		setErrorMessage(null);
		setIsVoiceMode((prev) => {
			const next = !prev;
			if (next) {
				setIsImageMode(false);
				setIsEditMode(false);
			}
			return next;
		});
	}, []);

	const handleSend = useCallback(async () => {
		if (!input.trim() || isProcessing) return;
		const trimmedInput = input.trim();
		setInput("");
		setIsProcessing(true);
		setErrorMessage(null);

		const userMessage: ChatMessage = {
			id: randomId(),
			role: "user",
			type: "text",
			content: trimmedInput,
		};

		setMessages((prev) => [...prev, userMessage]);

		const currentImageMode = isImageMode;
		const currentVoiceMode = isVoiceMode;
		const currentEditMode = isEditMode && canEditImage;

		setPendingIndicator(currentImageMode ? "image" : "text");

		try {
			if (currentImageMode) {
				const response = await fetch("/api/venice/image", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						prompt: trimmedInput,
						mode: currentEditMode ? "edit" : "generate",
						imageUrl: currentEditMode ? character.photoUrl : undefined,
						veniceParameters,
					}),
				});

				const data = await response.json();

				if (!response.ok) {
					throw new Error(data.error || "Image generation failed");
				}

				const imageMessage: ChatMessage = {
					id: randomId(),
					role: "assistant",
					type: "image",
					imageBase64: data.imageBase64,
					description: data.description || undefined,
				};

				setMessages((prev) => {
					const updated = [...prev, imageMessage];

					if (data.description) {
						updated.push({
							id: randomId(),
							role: "assistant",
							type: "text",
							content: `Here is ${data.description}`,
						});
					}

					return updated;
				});
			} else {
				const requestMessages = [...historyForCompletion, userMessage].map(
					(message) => ({
						role: message.role,
						content: message.content,
					}),
				);

				if (!character.slug) {
					requestMessages.unshift({
						role: "system",
						content: "You are a helpful assistant.",
					});
				}

				const response = await fetch("/api/venice/chat", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						messages: requestMessages,
						veniceParameters,
						voice: currentVoiceMode ? { enabled: true } : undefined,
					}),
				});

				const data = await response.json();
				if (!response.ok) {
					throw new Error(
						data.error || "Unable to fetch response from Venice.",
					);
				}

				const aiMessage: ChatMessage = {
					id: randomId(),
					role: "assistant",
					type: "text",
					content: data.reply,
				};

				setMessages((prev) => [...prev, aiMessage]);

				if (
					currentVoiceMode &&
					data.audio?.base64 &&
					data.audio?.mimeType
				) {
					const audioMessage: ChatMessage = {
						id: randomId(),
						role: "assistant",
						type: "audio",
						audioBase64: data.audio.base64,
						mimeType: data.audio.mimeType,
						text: data.reply,
					};
					setMessages((prev) => [...prev, audioMessage]);
				}
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Something went wrong.";

			setMessages((prev) => [
				...prev,
				{
					id: randomId(),
					role: "assistant",
					type: "text",
					content: `Error: ${message}`,
				},
			]);
			setErrorMessage(message);
		} finally {
			setPendingIndicator(null);
			setIsProcessing(false);
			setIsImageMode(false);
			setIsVoiceMode(false);
			setIsEditMode(false);
		}
	}, [
		input,
		isProcessing,
		isImageMode,
		isVoiceMode,
		isEditMode,
		canEditImage,
		character.photoUrl,
		character.slug,
		historyForCompletion,
		veniceParameters,
	]);

	return (
		<div className={styles.chatRoot}>
			<div className={styles.chatShell}>
				<header className={styles.header}>
					<h1>
						{experienceName} &middot; Chatting as{" "}
						<strong>{userDisplayName}</strong>
					</h1>
					<div className={styles.pillRow}>
						<span className={styles.pill}>Venice AI</span>
						{character.slug && (
							<span className={styles.pill}>
								Character: {character.slug}
							</span>
						)}
						{canEditImage && (
							<span className={styles.pill}>Image edits ready</span>
						)}
					</div>
					{character.photoUrl && (
						<div className={styles.characterPreview}>
							<img
								src={character.photoUrl}
								alt={displayName}
								className={styles.characterAvatar}
							/>
							<p>
								<strong>{displayName}</strong>
							</p>
						</div>
					)}
				</header>

				{errorMessage && (
					<div className={styles.errorBanner}>
						<strong>Heads up:</strong> {errorMessage}
					</div>
				)}

				<div className={styles.chatContainer}>
					{messages.length === 0 && !pendingIndicator ? (
						<div
							className={cx(
								styles.message,
								styles.aiMessage,
								styles.emptyState,
							)}
						>
							<strong>{displayName}:</strong> Ask me anything. Toggle the
							camera icon for image generation or the microphone for a
							narrated reply.
						</div>
					) : null}

					{messages.map((message) => {
						if (message.type === "text") {
							return (
								<div
									key={message.id}
									className={cx(
										styles.message,
										message.role === "user"
											? styles.userMessage
											: styles.aiMessage,
									)}
								>
									<strong>
										{message.role === "user" ? "You" : displayName}:
									</strong>{" "}
									{message.content}
								</div>
							);
						}

						if (message.type === "image") {
							return (
								<div
									key={message.id}
									className={cx(
										styles.message,
										styles.aiMessage,
										styles.imageMessage,
									)}
								>
									<img
										src={`data:image/webp;base64,${message.imageBase64}`}
										alt={message.description ?? "Generated visual"}
									/>
									{message.description && (
										<em>{message.description}</em>
									)}
								</div>
							);
						}

						return (
							<div
								key={message.id}
								className={cx(styles.message, styles.aiMessage)}
							>
								<strong>{displayName} (voice):</strong>
								<audio
									className={styles.audioElement}
									controls
									src={`data:${message.mimeType};base64,${message.audioBase64}`}
								/>
								<em>{message.text}</em>
							</div>
						);
					})}

					{pendingIndicator && (
						<div
							className={cx(
								styles.message,
								styles.aiMessage,
								styles.indicator,
							)}
						>
							<strong>
								{pendingIndicator === "image"
									? "Generating image..."
									: "Typing..."}
							</strong>
						</div>
					)}
				</div>

				<div className={styles.inputContainer}>
					<input
						type="text"
						className={styles.textInput}
						placeholder={
							isImageMode
								? "Describe the image you want to generate..."
								: "Type your message..."
						}
						value={input}
						disabled={isProcessing}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								handleSend();
							}
						}}
					/>

					<button
						type="button"
						className={cx(
							styles.toggle,
							isImageMode && styles.toggleActive,
						)}
						aria-pressed={isImageMode}
						onClick={handleToggleImageMode}
						disabled={isProcessing}
						title="Toggle image mode"
					>
						📷
					</button>

					<div
						className={cx(
							styles.editContainer,
							isImageMode && canEditImage && styles.editContainerVisible,
						)}
					>
						<label htmlFor="edit-mode">Edit</label>
						<input
							id="edit-mode"
							type="checkbox"
							checked={isEditMode && canEditImage}
							onChange={() => setIsEditMode((prev) => !prev)}
							disabled={!canEditImage || isProcessing || !isImageMode}
						/>
					</div>

					<button
						type="button"
						className={cx(
							styles.toggle,
							isVoiceMode && styles.toggleActive,
						)}
						aria-pressed={isVoiceMode}
						onClick={handleToggleVoiceMode}
						disabled={isProcessing}
						title="Toggle voice mode"
					>
						🗣️
					</button>

					<button
						type="button"
						className={styles.primaryButton}
						onClick={handleSend}
						disabled={isProcessing || !input.trim()}
						title="Send message"
					>
						➤
					</button>
				</div>
			</div>
		</div>
	);
}
