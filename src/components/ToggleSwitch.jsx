/* Shared on/off switch.

   Entity-agnostic on purpose: it takes a boolean and a callback, never an
   entity id. Cards own the optimistic state; this only draws it.

   It is a real <button>, so the tab stop, Enter/Space activation and the
   disabled semantics come from the platform rather than hand-rolled key
   handlers. `role="switch"` + `aria-checked` make it announce as "switch, on"
   instead of "button".

   `label` is required — an icon-only control with no accessible name is
   unusable with a screen reader or voice control ("click bedroom light
   switch" needs a name to match against).
*/
export function ToggleSwitch({ on, onToggle, label, disabled = false, className = "" }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`toggle ${on ? "on" : ""} ${className}`.trim()}
    />
  );
}
