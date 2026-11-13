// Performance — the SIU player-monitoring hub (staff side).
// Section comes from the path: /admin/performance/:section? and /players/:contactId.
import { useParams } from "wouter";
import Board from "./board";
import Players from "./players";
import PlayerPage from "./player";
import Wellness from "./wellness";
import Load from "./load";
import Availability from "./availability";
import Testing from "./testing";
import Video from "./video";
import ImportData from "./import";
import Sources from "./sources";

export default function PerformancePage() {
  const params = useParams<{ section?: string; contactId?: string }>();
  let body: JSX.Element;
  if (params.contactId) body = <PlayerPage key={params.contactId} contactId={params.contactId} />;
  else switch (params.section) {
    case undefined: case "": case "dashboard": body = <Board />; break;
    case "players": body = <Players />; break;
    case "wellness": body = <Wellness />; break;
    case "load": body = <Load />; break;
    case "availability": body = <Availability />; break;
    case "testing": body = <Testing />; break;
    case "video": body = <Video />; break;
    case "import": body = <ImportData />; break;
    case "sources": body = <Sources />; break;
    default: body = <Board />;
  }
  return <div className="p-4 md:p-6 max-w-7xl mx-auto min-w-0" data-testid="performance-page">{body}</div>;
}
