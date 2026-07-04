"use client";

import * as Select from "@radix-ui/react-select";

type SortOption<TValue extends string> = {
  value: TValue;
  label: string;
};

export function SortSelect<TValue extends string>({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: readonly SortOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
}) {
  return (
    <div className="catalog-sort-control">
      <span>{label}</span>
      <Select.Root value={value} onValueChange={(nextValue) => onValueChange(nextValue as TValue)}>
        <Select.Trigger className="catalog-select-trigger" aria-label={label}>
          <Select.Value />
          <Select.Icon asChild aria-hidden="true">
            <span className="control-chevron" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="control-menu" position="popper" sideOffset={6}>
            <Select.Viewport>
              {options.map((option) => (
                <Select.Item className="control-menu-option" value={option.value} key={option.value}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
