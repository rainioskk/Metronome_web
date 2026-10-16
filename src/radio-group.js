export function updateRadioGroup(group, isSelected) {
  group.querySelectorAll('[role="radio"]').forEach(button => {
    const selected = isSelected(button);
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

export function bindRadioGroup(group, select) {
  group.addEventListener("keydown", event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = [...group.querySelectorAll('[role="radio"]')];
    const index = buttons.indexOf(event.target.closest('[role="radio"]'));
    if (index < 0) return;
    let next;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    select(buttons[next]);
    buttons[next].focus({ preventScroll: true });
  });
}
