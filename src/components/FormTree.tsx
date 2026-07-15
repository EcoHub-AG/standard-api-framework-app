import { Folder } from "lucide-react";
import { ENUMS, WIDE_KEYS } from "../data/standards";
import { humanize, isObj } from "../lib/format";

// Recursive nested form editor (PRD F6 — read/edit payload as a structured form).
function Leaf({ pathKey, value, path, readOnly, onChange }: {
  pathKey: string; value: any; path: string; readOnly: boolean; onChange: (p: string, v: any) => void;
}) {
  const opts = ENUMS[pathKey];
  const wide = WIDE_KEYS.includes(pathKey);

  let field;
  if (readOnly) {
    field = <div className={"leaf-ro" + (value === "" || value == null ? " empty" : "")}>{String(value ?? "—")}</div>;
  } else if (opts) {
    const list = value !== "" && value != null && !opts.includes(value) ? [value, ...opts] : opts;
    field = (
      <div className="selectw">
        <select value={String(value ?? "")} onChange={(e) => onChange(path, e.target.value)}>
          {list.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>
    );
  } else if (wide) {
    field = <textarea className="ctl" rows={2} value={String(value ?? "")} onChange={(e) => onChange(path, e.target.value)} />;
  } else {
    const isNum = typeof value === "number";
    const isDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
    field = (
      <input
        className="ctl"
        type={isNum ? "number" : isDate ? "date" : "text"}
        value={String(value ?? "")}
        onChange={(e) => onChange(path, isNum ? Number(e.target.value) : e.target.value)}
      />
    );
  }

  return (
    <div className={"leaf" + (wide ? " wide" : "")}>
      <span className="leaf-key">{humanize(pathKey)}</span>
      {field}
    </div>
  );
}

function Node({ obj, base, readOnly, onChange }: {
  obj: any; base: string; readOnly: boolean; onChange: (p: string, v: any) => void;
}) {
  const keys = Object.keys(obj);
  const leaves = keys.filter((k) => !isObj(obj[k]));
  const groups = keys.filter((k) => isObj(obj[k]));

  return (
    <div className="grp-body">
      {leaves.map((k) => (
        <Leaf key={k} pathKey={k} value={obj[k]} path={base ? `${base}.${k}` : k} readOnly={readOnly} onChange={onChange} />
      ))}
      {groups.map((k) => {
        const child = obj[k];
        return (
          <div className="subgrp" key={k}>
            <div className="grp-head">
              <Folder className="grp-icon" size={13} />
              <span className="grp-key">{k}</span>
              <span className="grp-count">{Object.keys(child).length}</span>
            </div>
            <Node obj={child} base={base ? `${base}.${k}` : k} readOnly={readOnly} onChange={onChange} />
          </div>
        );
      })}
    </div>
  );
}

export default function FormTree({ values, readOnly = false, onChange }: {
  values: any; readOnly?: boolean; onChange?: (path: string, value: any) => void;
}) {
  return (
    <div className="form-tree">
      <Node obj={values} base="" readOnly={readOnly} onChange={onChange ?? (() => {})} />
    </div>
  );
}
