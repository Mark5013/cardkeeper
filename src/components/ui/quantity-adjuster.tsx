"use client";

import { useState } from "react";

type QuantityAdjusterProps = {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  min?: number;
  max?: number;
  required?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeQuantityInput(value: string) {
  return value.replace(/\D/g, "");
}

export function QuantityAdjuster({
  label,
  value,
  onValueChange,
  min = 1,
  max = 9999,
  required,
}: QuantityAdjusterProps) {
  const [hoveredControl, setHoveredControl] = useState<"decrease" | "increase" | null>(null);

  function adjustQuantity(delta: -1 | 1) {
    const parsed = Number(value);
    const current = Number.isInteger(parsed) ? parsed : min;
    onValueChange(String(clamp(current + delta, min, max)));
  }

  return (
    <div className="quantity-adjuster">
      <button
        className="quantity-adjuster-button"
        data-hovered={hoveredControl === "decrease"}
        type="button"
        onClick={() => adjustQuantity(-1)}
        onMouseEnter={() => setHoveredControl("decrease")}
        onMouseLeave={() => setHoveredControl(null)}
        onFocus={() => setHoveredControl("decrease")}
        onBlur={() => setHoveredControl(null)}
        aria-label={`Decrease ${label.toLowerCase()}`}
      >
        -
      </button>
      <input
        className="number-field quantity-adjuster-input"
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={value}
        onChange={(event) => onValueChange(sanitizeQuantityInput(event.target.value))}
        required={required}
      />
      <button
        className="quantity-adjuster-button"
        data-hovered={hoveredControl === "increase"}
        type="button"
        onClick={() => adjustQuantity(1)}
        onMouseEnter={() => setHoveredControl("increase")}
        onMouseLeave={() => setHoveredControl(null)}
        onFocus={() => setHoveredControl("increase")}
        onBlur={() => setHoveredControl(null)}
        aria-label={`Increase ${label.toLowerCase()}`}
      >
        +
      </button>
    </div>
  );
}
