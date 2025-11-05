import { headers } from "next/headers";
import { whopsdk } from "@/lib/whop-sdk";
import { ChatExperience } from "./ChatExperience";

export default async function ExperiencePage({
	params,
}: {
	params: { experienceId: string };
}) {
	const { experienceId } = params;
	// Ensure the user is logged in on whop.
	const { userId } = await whopsdk.verifyUserToken(await headers());

	// Fetch the neccessary data we want from whop.
	const [experience, user, access] = await Promise.all([
		whopsdk.experiences.retrieve(experienceId),
		whopsdk.users.retrieve(userId),
		whopsdk.users.checkAccess(experienceId, { id: userId }),
	]);

	const displayName = user.name || `@${user.username}`;
	const character = {
		slug: process.env.NEXT_PUBLIC_VENICE_CHARACTER_SLUG || "",
		name: process.env.NEXT_PUBLIC_VENICE_CHARACTER_NAME || "",
		photoUrl: process.env.NEXT_PUBLIC_VENICE_CHARACTER_PHOTO || "",
	};

	if (!access?.has_access) {
		throw new Error("User does not have access to this experience.");
	}

	return (
		<ChatExperience
			character={character}
			experienceName={experience.name}
			userDisplayName={displayName}
		/>
	);
}
