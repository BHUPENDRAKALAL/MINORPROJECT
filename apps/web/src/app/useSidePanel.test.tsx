import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SIDE_DEFAULT, SIDE_MAX, useSidePanel } from "./useSidePanel";

function Harness() {
  const side = useSidePanel();
  return (
    <div>
      <output data-testid="state">{side.folded ? "folded" : `open:${side.width}`}</output>
      <div data-testid="edge" {...side.handleProps} />
      <input data-testid="field" />
    </div>
  );
}

const state = () => screen.getByTestId("state").textContent;
const edge = () => screen.getByTestId("edge");

afterEach(cleanup);

// jsdom has no pointer capture; the hook only needs these to exist.
beforeEach(() => {
  localStorage.clear();
  Object.assign(HTMLElement.prototype, {
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture() {
      return true;
    },
  });
});

function dragBy(dx: number) {
  fireEvent.pointerDown(edge(), { button: 0, clientX: 300, pointerId: 1 });
  fireEvent.pointerMove(edge(), { clientX: 300 + dx, pointerId: 1 });
  fireEvent.pointerUp(edge(), { clientX: 300 + dx, pointerId: 1 });
}

describe("side panel (VS Code style)", () => {
  it("starts open at the default width", () => {
    render(<Harness />);
    expect(state()).toBe(`open:${SIDE_DEFAULT}`);
  });

  it("resizes by dragging the edge and stops at the maximum", () => {
    render(<Harness />);
    dragBy(60);
    expect(state()).toBe(`open:${SIDE_DEFAULT + 60}`);
    dragBy(1000);
    expect(state()).toBe(`open:${SIDE_MAX}`);
  });

  it("folds when dragged very narrow, and opens again when dragged out", () => {
    render(<Harness />);
    dragBy(-200);
    expect(state()).toBe("folded");
    dragBy(260);
    expect(state()).toBe("open:260");
  });

  it("opens again at the width it had before it was dragged closed", () => {
    render(<Harness />);
    dragBy(100);
    expect(state()).toBe(`open:${SIDE_DEFAULT + 100}`);
    fireEvent.pointerDown(edge(), { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(edge(), { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(edge(), { clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(edge(), { clientX: 0, pointerId: 1 });
    expect(state()).toBe("folded");
    act(() => void fireEvent.keyDown(window, { key: "b", ctrlKey: true }));
    expect(state()).toBe(`open:${SIDE_DEFAULT + 100}`);
  });

  it("toggles with Ctrl+B, but not while typing in a field", () => {
    render(<Harness />);
    act(() => void fireEvent.keyDown(window, { key: "b", ctrlKey: true }));
    expect(state()).toBe("folded");
    fireEvent.keyDown(screen.getByTestId("field"), { key: "b", ctrlKey: true });
    expect(state()).toBe("folded");
    act(() => void fireEvent.keyDown(window, { key: "B", metaKey: true }));
    expect(state()).toBe(`open:${SIDE_DEFAULT}`);
  });

  it("resets on double-click and remembers the width", () => {
    const first = render(<Harness />);
    dragBy(80);
    first.unmount();
    render(<Harness />);
    expect(state()).toBe(`open:${SIDE_DEFAULT + 80}`);
    fireEvent.doubleClick(edge());
    expect(state()).toBe(`open:${SIDE_DEFAULT}`);
  });

  it("works from the keyboard", () => {
    render(<Harness />);
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(state()).toBe(`open:${SIDE_DEFAULT + 16}`);
    fireEvent.keyDown(edge(), { key: "Enter" });
    expect(state()).toBe("folded");
    fireEvent.keyDown(edge(), { key: "Home" });
    expect(state()).toBe(`open:${SIDE_DEFAULT}`);
  });
});
