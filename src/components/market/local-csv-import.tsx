"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/shadcn/alert-dialog";
import { Alert, AlertDescription } from "@/components/shadcn/alert";
import { Button } from "@/components/shadcn/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/card";
import { Checkbox } from "@/components/shadcn/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/shadcn/field";
import { Input } from "@/components/shadcn/input";
import { RadioGroup, RadioGroupItem } from "@/components/shadcn/radio-group";

function errorMessage(payload: unknown, status: number) {
  if (status === 413) return "CSV 文件不能超过 4 MiB。";
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload)
  ) {
    return "本机未能导入该文件，请检查格式后重试。";
  }

  const apiError = payload.error;
  if (typeof apiError !== "object" || apiError === null) {
    return "本机未能导入该文件，请检查格式后重试。";
  }
  if (!("details" in apiError) || !Array.isArray(apiError.details)) {
    return "本机未能导入该文件，请检查格式后重试。";
  }

  const details = apiError.details as Array<{ path?: unknown; code?: unknown }>;
  const first = details[0];
  if (first?.path === "rightsConfirmed")
    return "请先确认拥有该文件的本机保存权限。";
  if (first?.code === "CSV_FILE_REQUIRED") return "请选择 CSV 文件。";
  switch (first?.code) {
    case "FILE_TOO_LARGE":
      return "CSV 文件不能超过 4 MiB。";
    case "INVALID_UTF8":
      return "文件必须使用 UTF-8 编码。";
    case "INVALID_CSV":
      return "CSV 引号或分隔格式无效。";
    case "INVALID_HEADERS":
      return "CSV 表头需包含 Date、Open、High、Low、Close 和 Volume。";
    case "NO_DATA_ROWS":
      return "CSV 中没有行情记录。";
    case "TOO_MANY_ROWS":
      return "单个文件最多导入 50,000 条日线。";
    case "DUPLICATE_DATE":
      return "文件中有重复交易日期，请先处理重复行。";
    case "SYMBOL_MISMATCH":
      return "CSV 中的证券代码与表单填写值不一致。";
    case "INVALID_DATA_ROW":
      return "日期、OHLC 价格或成交量格式无效，请检查 CSV 数据行。";
    default:
      return "本机未能导入该文件，请检查格式后重试。";
  }
}

export function LocalCsvImport() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(errorMessage(payload, response.status));
        return;
      }
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("data" in payload) ||
        typeof payload.data !== "object" ||
        payload.data === null ||
        !("rowsAdded" in payload.data) ||
        typeof payload.data.rowsAdded !== "number" ||
        !("rowsInFile" in payload.data) ||
        typeof payload.data.rowsInFile !== "number"
      ) {
        setError("服务器返回了无法识别的导入结果。");
        return;
      }

      const { rowsAdded, rowsInFile } = payload.data;
      toast.success(
        rowsAdded === 0 ? "该文件已导入过" : `已导入 ${rowsAdded} 条日线`,
        { description: `文件共 ${rowsInFile} 条，来源仍标记为 NOT_VERIFIED。` },
      );
      form.reset();
      router.refresh();
    } catch {
      setError("无法连接本机导入接口，请确认应用仍在运行。");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id="local-market-import-heading">导入本机行情 CSV</h2>
          </CardTitle>
          <CardDescription>
            选择本地日线文件；应用不会访问外部数据源。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Alert>
            <AlertDescription>
              导入值和来源许可均标记为
              NOT_VERIFIED；这里只供人工查看，不会进入回测、策略评分或模拟成交。解析后的行情记录保存在本机数据库，原始
              CSV 不会留存。
            </AlertDescription>
          </Alert>
          <form
            action="/api/v1/market-data/import"
            aria-labelledby="local-market-import-heading"
            encType="multipart/form-data"
            method="post"
            onSubmit={submit}
            className="flex flex-col gap-4"
          >
            <FieldGroup>
              <FieldSet>
                <FieldLegend>市场</FieldLegend>
                <RadioGroup
                  className="grid gap-4 sm:grid-cols-2"
                  defaultValue="US"
                  name="market"
                >
                  <Field orientation="horizontal">
                    <RadioGroupItem id="market-us" value="US" />
                    <FieldLabel htmlFor="market-us">美国市场 · USD</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem id="market-jp" value="JP" />
                    <FieldLabel htmlFor="market-jp">日本市场 · JPY</FieldLabel>
                  </Field>
                </RadioGroup>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="local-market-symbol">证券代码</FieldLabel>
                <Input
                  autoCapitalize="characters"
                  autoComplete="off"
                  id="local-market-symbol"
                  maxLength={32}
                  name="symbol"
                  pattern="[A-Za-z0-9][A-Za-z0-9.\-]{0,31}"
                  required
                  spellCheck={false}
                />
                <FieldDescription>
                  例如 AAPL 或 7203；一次导入一个证券。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="local-market-file">
                  日线 CSV 文件
                </FieldLabel>
                <Input
                  accept=".csv,text/csv"
                  id="local-market-file"
                  name="file"
                  required
                  type="file"
                />
                <FieldDescription>
                  UTF-8，需包含 Date、Open、High、Low、Close、Volume；日期使用
                  YYYY-MM-DD。仅支持未复权日线。
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="local-market-rights"
                  name="rightsConfirmed"
                  required
                  value="on"
                />
                <FieldContent>
                  <FieldLabel htmlFor="local-market-rights">
                    我确认有权将此文件保存在本机
                  </FieldLabel>
                  <FieldDescription>
                    此确认不会改变系统的来源核验状态。
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>
            <Button className="self-start" disabled={pending} type="submit">
              {pending ? "正在导入…" : "导入行情"}
            </Button>
          </form>
        </CardContent>
      </Card>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setError(null);
        }}
        open={error !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>行情文件未导入</AlertDialogTitle>
            <AlertDialogDescription>{error}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>知道了</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
