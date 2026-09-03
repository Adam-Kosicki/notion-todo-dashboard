import { getChatGPTUser } from "./chatgpt-auth";
import BoardApp from "./board-app";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return <BoardApp displayName={user?.fullName || user?.email || "Planner"} />;
}
