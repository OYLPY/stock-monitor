"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { zhCN } from "react-day-picker/locale";

import { Calendar } from "@/components/shadcn/calendar";
import {
  InputGroup,
  InputGroupButton,
  InputGroupInput,
} from "@/components/shadcn/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shadcn/popover";

function toDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  return toDateValue(date) === value ? date : undefined;
}

function toDateValue(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function BacktestDatePicker({
  id,
  name,
  placeholder,
  value,
}: {
  id: string;
  name: string;
  placeholder: string;
  value: string;
}) {
  const [dateValue, setDateValue] = useState(value);
  const [open, setOpen] = useState(false);
  const date = toDate(dateValue);

  return (
    <InputGroup>
      <InputGroupInput
        autoComplete="off"
        id={id}
        maxLength={10}
        name={name}
        onChange={(event) => setDateValue(event.currentTarget.value)}
        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
        placeholder="YYYY-MM-DD"
        required
        value={dateValue}
      />
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger
          render={<InputGroupButton aria-label={placeholder} size="icon-sm" />}
        >
          <CalendarDays aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          <Calendar
            locale={zhCN}
            mode="single"
            onSelect={(selectedDate) => {
              if (selectedDate) {
                setDateValue(toDateValue(selectedDate));
                setOpen(false);
              }
            }}
            selected={date}
            timeZone="UTC"
          />
        </PopoverContent>
      </Popover>
    </InputGroup>
  );
}
