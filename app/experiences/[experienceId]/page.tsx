import { headers } from "next/headers";
import { whopsdk } from "@/lib/whop-sdk";
import { ChatExperience } from "./ChatExperience";

export default async function ExperiencePage({
	params,
}: {
	params: Promise<{ experienceId: string }>;
}) {
	const { experienceId } = await params;
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
		return (
			<div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
				<h1 className="text-7 font-semibold">Access required</h1>
				<p className="max-w-md text-3 text-gray-10">
					It looks like you don&apos;t currently have access to this
					experience. Please check your membership or contact support if
					you believe this is a mistake.
				</p>
			</div>
		);
	}

	return (
		<ChatExperience
			character={character}
			experienceName={experience.name}
			userDisplayName={displayName}
		/>
	);
}
