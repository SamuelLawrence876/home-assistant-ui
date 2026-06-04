import { PiCard } from "../cards/system/PiCard.jsx";
import { UptimeCard } from "../cards/system/UptimeCard.jsx";
import { AddonsCard } from "../cards/system/AddonsCard.jsx";
import { AdGuardSimpleCard } from "../cards/system/AdGuardCard.jsx";
import { BackupCard } from "../cards/system/BackupCard.jsx";
import { StorageCard } from "../cards/system/StorageCard.jsx";
import { EntityHealthCard } from "../cards/system/EntityHealthCard.jsx";
import { SystemActionsCard } from "../cards/system/SystemActionsCard.jsx";

export default function SystemView() {
  return (
    <div className="grid">
      <div className="col-6"><PiCard index={0} /></div>
      <div className="col-6"><UptimeCard index={1} /></div>

      <div className="col-6"><AddonsCard index={2} /></div>
      <div className="col-6"><AdGuardSimpleCard index={3} /></div>

      <div className="col-6"><BackupCard index={4} /></div>
      <div className="col-6"><StorageCard index={5} /></div>

      <div className="col-8"><EntityHealthCard index={6} /></div>
      <div className="col-4"><SystemActionsCard index={7} /></div>
    </div>
  );
}
