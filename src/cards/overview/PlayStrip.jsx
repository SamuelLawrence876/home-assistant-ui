import { Card } from "../../components/Card.jsx";
import { SamBoxStrip } from "./SamBoxStrip.jsx";

export function PlayStrip({ index = 0 }) {
  return (
    <Card index={index} className="playstrip-card" eyebrow="Gaming" title="Play" meta="SamBox360">
      <SamBoxStrip compact />
    </Card>
  );
}
