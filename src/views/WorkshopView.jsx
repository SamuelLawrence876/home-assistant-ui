import { PrinterCard } from "../cards/workshop/PrinterCard.jsx";
import { VacuumCard } from "../cards/workshop/VacuumCard.jsx";

export default function WorkshopView() {
  return (
    <div className="grid">
      <div className="col-6"><PrinterCard index={0} /></div>
      <div className="col-6"><VacuumCard index={1} /></div>
    </div>
  );
}
