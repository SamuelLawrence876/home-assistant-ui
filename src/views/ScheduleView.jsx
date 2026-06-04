import { WeeklyCalendarCard } from "../cards/schedule/WeeklyCalendarCard.jsx";
import { KanbanBoardCard } from "../cards/schedule/KanbanBoardCard.jsx";

export default function ScheduleView() {
  return (
    <div className="grid">
      <div className="col-12"><WeeklyCalendarCard index={0} /></div>
      <div className="col-12"><KanbanBoardCard index={1} /></div>
    </div>
  );
}
