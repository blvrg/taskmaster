"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { VeniceMessage } from "@/lib/venice";
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

type ChatThread = {
	id: string;
	name: string;
	createdAt: number;
	messages: ChatMessage[];
};

type StoredThreadsState = {
	activeThreadId: string;
	threads: ChatThread[];
};

const STORAGE_KEY = "venice-chat-threads";

function createThread(name?: string): ChatThread {
	return {
		id: randomId(),
		name: name ?? "New chat",
		createdAt: Date.now(),
		messages: [],
	};
}

export function ChatExperience({
	character,
	experienceName,
	userDisplayName,
}: ChatExperienceProps) {
	const [threads, setThreads] = useState<ChatThread[]>(() => {
		const initial = createThread("Session 1");
		return [initial];
	});
	const [activeThreadId, setActiveThreadId] = useState<string>(
		() => threads[0]?.id ?? "",
	);
	const [isHydrated, setIsHydrated] = useState(false);
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

	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const saved = window.localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved) as StoredThreadsState;
				if (Array.isArray(parsed?.threads) && parsed.threads.length > 0) {
					setThreads(parsed.threads);
					const storedActiveId = parsed.activeThreadId;
					if (
						storedActiveId &&
						parsed.threads.some((thread) => thread.id === storedActiveId)
					) {
						setActiveThreadId(storedActiveId);
					} else {
						setActiveThreadId(parsed.threads[0]!.id);
					}
				}
			}
		} catch (error) {
			console.warn("Unable to hydrate Venice threads from storage:", error);
		} finally {
			setIsHydrated(true);
		}
	}, []);

	useEffect(() => {
		if (!isHydrated || typeof window === "undefined") return;
		const state: StoredThreadsState = {
			activeThreadId,
			threads,
		};
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (error) {
			console.warn("Unable to persist Venice threads:", error);
		}
	}, [activeThreadId, threads, isHydrated]);

	const activeThread = useMemo(() => {
		const resolved =
			threads.find((thread) => thread.id === activeThreadId) ?? threads[0];
		return resolved ?? null;
	}, [threads, activeThreadId]);

	const activeMessages = activeThread?.messages ?? [];

	const historyForCompletion = useMemo<VeniceMessage[]>(
		() =>
			activeMessages
				.filter(
					(message): message is Extract<ChatMessage, { type: "text" }> =>
						message.type === "text",
				)
				.slice(-20)
				.map((message) => ({
					role: message.role,
					content: message.content,
				})),
		[activeMessages],
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

	const updateThreadMessages = useCallback(
		(
			threadId: string,
			updater: (messages: ChatMessage[]) => ChatMessage[],
		) => {
			setThreads((prev) =>
				prev.map((thread) =>
					thread.id === threadId
						? {
								...thread,
								messages: updater(thread.messages),
							}
						: thread,
				),
			);
		},
		[],
	);

	const handleSelectThread = useCallback((threadId: string) => {
		setActiveThreadId(threadId);
		setErrorMessage(null);
		setPendingIndicator(null);
	}, []);

	const handleCreateThread = useCallback(() => {
		const newThread = createThread(`Chat ${threads.length + 1}`);
		setThreads((prev) => [...prev, newThread]);
		setActiveThreadId(newThread.id);
		setInput("");
		setErrorMessage(null);
		setPendingIndicator(null);
	}, [threads.length]);

	const handleDeleteThread = useCallback(
		(threadId: string) => {
			setThreads((prev) => {
				if (prev.length <= 1) {
					return prev;
				}
				const filtered = prev.filter((thread) => thread.id !== threadId);
				if (threadId === activeThreadId) {
					const nextThread = filtered[filtered.length - 1];
					if (nextThread) {
						setActiveThreadId(nextThread.id);
					}
				}
				return filtered;
			});
		},
		[activeThreadId],
	);

	const handleSend = useCallback(async () => {
		if (!input.trim() || isProcessing) return;
		if (!activeThread) return;
		const trimmedInput = input.trim();
		setInput("");
		setIsProcessing(true);
		setErrorMessage(null);

		const targetThreadId = activeThread.id;

		const userMessage: ChatMessage = {
			id: randomId(),
			role: "user",
			type: "text",
			content: trimmedInput,
		};

		updateThreadMessages(targetThreadId, (prev) => [...prev, userMessage]);

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

				updateThreadMessages(targetThreadId, (prev) => {
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
				const requestMessages: VeniceMessage[] = [
					...historyForCompletion,
					{
						role: userMessage.role,
						content: userMessage.content,
					},
				];

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

				updateThreadMessages(targetThreadId, (prev) => [
					...prev,
					aiMessage,
				]);

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
					updateThreadMessages(targetThreadId, (prev) => [
						...prev,
						audioMessage,
					]);
				}
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Something went wrong.";

			updateThreadMessages(targetThreadId, (prev) => [
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
		updateThreadMessages,
		veniceParameters,
		activeThread,
	]);

	const characterInitial = displayName.charAt(0).toUpperCase();

	return (
		<div className={styles.chatRoot}>
			<header className={styles.topBar}>
				<div className={styles.identity}>
					{character.photoUrl ? (
						<img
							src={character.photoUrl}
							alt={displayName}
							className={styles.avatar}
							referrerPolicy="no-referrer"
						/>
					) : (
						<span className={styles.avatarFallback} aria-hidden>
							{characterInitial}
						</span>
					)}
					<div className={styles.identityText}>
						<p className={styles.identityLabel}>{experienceName}</p>
						<h1 className={styles.identityTitle}>
							Chat with <span>{displayName}</span>
						</h1>
					</div>
				</div>
				<p className={styles.subtle}>Signed in as {userDisplayName}</p>
			</header>

			<main className={styles.mainArea}>
				<nav className={styles.threadBar}>
					<div className={styles.threadList}>
						{threads.map((thread) => (
							<div key={thread.id} className={styles.threadPill}>
								<button
									type="button"
									className={cx(
										styles.threadButton,
										thread.id === activeThread?.id &&
											styles.threadButtonActive,
									)}
									onClick={() => handleSelectThread(thread.id)}
									disabled={thread.id === activeThread?.id}
									title={`Switch to ${thread.name}`}
								>
									{thread.name}
								</button>
								<button
									type="button"
									className={styles.threadDeleteButton}
									onClick={() => handleDeleteThread(thread.id)}
									disabled={threads.length <= 1}
									title="Delete chat"
								>
									×
								</button>
							</div>
						))}
					</div>
					<button
						type="button"
						className={styles.newThreadButton}
						onClick={handleCreateThread}
					>
						＋ New chat
					</button>
				</nav>

				<section className={styles.messageRegion}>
					{activeMessages.length === 0 && !pendingIndicator ? (
						<div
							className={cx(
								styles.message,
								styles.aiMessage,
								styles.emptyState,
							)}
						>
							<strong>{displayName}:</strong> Ask me anything. Use the
							camera to switch into image mode or the microphone for
							voice playback.
						</div>
					) : null}

					{activeMessages.map((message) => {
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
										<span className={styles.caption}>
											{message.description}
										</span>
									)}
								</div>
							);
						}

						return (
							<div
								key={message.id}
								className={cx(styles.message, styles.aiMessage)}
							>
								<audio
									className={styles.audioElement}
									controls
									src={`data:${message.mimeType};base64,${message.audioBase64}`}
								/>
								<span className={styles.caption}>{message.text}</span>
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
							{pendingIndicator === "image"
								? "Generating image..."
								: "Crafting a reply..."}
						</div>
					)}
				</section>

				<div className={styles.composerSection}>
					{errorMessage && (
						<div className={styles.errorBanner}>
							<strong>Heads up:</strong> {errorMessage}
						</div>
					)}

					<div className={styles.inputContainer}>
						<input
							type="text"
							className={styles.textInput}
							placeholder={
								isImageMode
									? "Describe the visual you want..."
									: "Send a message..."
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

						<div className={styles.actions}>
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
									isImageMode &&
										canEditImage &&
										styles.editContainerVisible,
								)}
							>
								<label htmlFor="edit-mode">Edit</label>
								<input
									id="edit-mode"
									type="checkbox"
									checked={isEditMode && canEditImage}
									onChange={() => setIsEditMode((prev) => !prev)}
									disabled={
										!canEditImage || isProcessing || !isImageMode
									}
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
			</main>
		</div>
	);
}
