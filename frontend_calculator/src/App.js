import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Calculator behaviors implemented:
 * - Digits, decimal
 * - +, -, ×, ÷
 * - % (acts as "percent of previous value" if a binary op is active; otherwise divides by 100)
 * - ± sign toggle
 * - AC clear
 * - chaining ops (operator computes pending op first)
 * - repeated equals (press '=' multiple times repeats last op)
 * - division by zero => Error state, next digit starts fresh
 * - keyboard input support for digits/operators/Enter/Backspace/Escape/./%
 */

// PUBLIC_INTERFACE
function App() {
  /**
   * Core state.
   * display: current number being entered OR result shown (string to preserve user typing like "0." / "0002")
   * prevValue: stored numeric value used as left operand for pending operation (number | null)
   * pendingOp: "+", "-", "*", "/" | null
   * lastOp: for repeated equals: { op, rhs } where rhs is number
   * previousLine: UI helper (e.g., "12 +")
   * overwrite: whether next digit should start a new entry (after equals or after operator press)
   * error: whether calculator is in Error state
   */
  const [display, setDisplay] = useState("0");
  const [prevValue, setPrevValue] = useState(null);
  const [pendingOp, setPendingOp] = useState(null);
  const [lastOp, setLastOp] = useState(null);
  const [previousLine, setPreviousLine] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState(false);

  // For accessibility: keep focus on the main container so keyboard works naturally.
  const containerRef = useRef(null);

  const THEME = useMemo(
    () => ({
      primary: "#2563EB",
      secondary: "#F59E0B",
      background: "#f9fafb",
      surface: "#ffffff",
      text: "#111827",
      error: "#EF4444",
      border: "rgba(17, 24, 39, 0.12)",
      subtle: "rgba(17, 24, 39, 0.6)",
      shadow: "0 12px 30px rgba(17, 24, 39, 0.10)",
    }),
    []
  );

  const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);

  const parseDisplayToNumber = useCallback((valueStr) => {
    // Accepts "0.", "-0.", etc. parseFloat handles trailing dot => number,
    // but keep special case for lone "-" which can happen during sign toggle transitions.
    if (valueStr === "-" || valueStr === "" || valueStr === ".") return 0;
    const n = Number(valueStr);
    if (Number.isNaN(n)) return 0;
    return n;
  }, []);

  const formatNumber = useCallback((n) => {
    if (!isFiniteNumber(n)) return "Error";

    // Round to ~10 decimal places then trim trailing zeros.
    // Use toFixed to combat floating precision tails.
    const rounded = Math.round((n + Number.EPSILON) * 1e10) / 1e10;

    // Avoid "-0"
    const normalized = Object.is(rounded, -0) ? 0 : rounded;

    // Convert to string without long tails. If integer, keep as integer.
    let s = String(normalized);

    // If scientific notation, keep it (still readable)
    if (s.includes("e") || s.includes("E")) return s;

    // Trim trailing zeros for decimals
    if (s.includes(".")) {
      s = s.replace(/\.?0+$/, "");
    }
    return s;
  }, []);

  const setErrorState = useCallback(() => {
    setError(true);
    setDisplay("Error");
    setPrevValue(null);
    setPendingOp(null);
    setPreviousLine("");
    setLastOp(null);
    setOverwrite(true);
  }, []);

  const clearAll = useCallback(() => {
    setError(false);
    setDisplay("0");
    setPrevValue(null);
    setPendingOp(null);
    setLastOp(null);
    setPreviousLine("");
    setOverwrite(false);
  }, []);

  const compute = useCallback(
    (a, op, b) => {
      // Safe evaluation, no eval.
      if (!isFiniteNumber(a) || !isFiniteNumber(b)) return { ok: false, value: NaN };

      switch (op) {
        case "+":
          return { ok: true, value: a + b };
        case "-":
          return { ok: true, value: a - b };
        case "*":
          return { ok: true, value: a * b };
        case "/":
          if (b === 0) return { ok: false, value: NaN };
          return { ok: true, value: a / b };
        default:
          return { ok: false, value: NaN };
      }
    },
    [isFiniteNumber]
  );

  const inputDigit = useCallback(
    (digit) => {
      if (error) {
        // Any digit starts fresh from error.
        setError(false);
        setPrevValue(null);
        setPendingOp(null);
        setPreviousLine("");
        setLastOp(null);
        setDisplay(String(digit));
        setOverwrite(false);
        return;
      }

      setDisplay((prev) => {
        if (overwrite) {
          setOverwrite(false);
          return String(digit);
        }
        if (prev === "0") return String(digit);
        if (prev === "-0") return "-" + String(digit);
        return prev + String(digit);
      });
    },
    [error, overwrite]
  );

  const inputDecimal = useCallback(() => {
    if (error) {
      // Start fresh from error with "0."
      setError(false);
      setPrevValue(null);
      setPendingOp(null);
      setPreviousLine("");
      setLastOp(null);
      setDisplay("0.");
      setOverwrite(false);
      return;
    }

    setDisplay((prev) => {
      if (overwrite) {
        setOverwrite(false);
        return "0.";
      }
      if (prev.includes(".")) return prev;
      if (prev === "Error") return "0.";
      if (prev === "-" || prev === "") return "0.";
      return prev + ".";
    });
  }, [error, overwrite]);

  const toggleSign = useCallback(() => {
    if (error) return;
    setDisplay((prev) => {
      if (prev === "0" || prev === "0.") return "-0" + (prev.endsWith(".") ? "." : "");
      if (prev === "-0" || prev === "-0.") return "0" + (prev.endsWith(".") ? "." : "");
      if (prev.startsWith("-")) return prev.slice(1);
      return "-" + prev;
    });
  }, [error]);

  const backspace = useCallback(() => {
    if (error) {
      // Backspace clears error like AC-lite.
      clearAll();
      return;
    }

    setDisplay((prev) => {
      if (overwrite) return "0";
      if (prev.length <= 1) return "0";
      if (prev.length === 2 && prev.startsWith("-")) return "0";
      return prev.slice(0, -1);
    });
  }, [clearAll, error, overwrite]);

  const applyPercent = useCallback(() => {
    if (error) return;

    const current = parseDisplayToNumber(display);

    // If we have a pending binary operation, many calculators treat % as "percent of prevValue"
    // e.g., "200 + 10 %" => 200 + (200 * 0.10) => 220
    if (pendingOp && prevValue !== null) {
      const pctValue = prevValue * (current / 100);
      setDisplay(formatNumber(pctValue));
      setOverwrite(true); // treat as computed operand; next digit starts new number
      return;
    }

    // Otherwise just divide by 100
    const value = current / 100;
    setDisplay(formatNumber(value));
    setOverwrite(true);
  }, [display, error, formatNumber, parseDisplayToNumber, pendingOp, prevValue]);

  const setOperator = useCallback(
    (op) => {
      if (error) return;

      const current = parseDisplayToNumber(display);

      // If user presses an operator repeatedly, update pending op without changing values,
      // but keep previousLine accurate.
      if (pendingOp && overwrite) {
        setPendingOp(op);
        setPreviousLine(`${formatNumber(prevValue ?? 0)} ${opSymbol(op)}`);
        return;
      }

      // If there is already a pending op and prevValue set, compute chaining
      if (pendingOp && prevValue !== null) {
        const result = compute(prevValue, pendingOp, current);
        if (!result.ok || !isFiniteNumber(result.value)) {
          setErrorState();
          return;
        }

        const formatted = formatNumber(result.value);
        const numeric = Number(formatted); // safe because formatted may be "Error" already handled

        setPrevValue(numeric);
        setDisplay(formatted);
        setPendingOp(op);
        setPreviousLine(`${formatted} ${opSymbol(op)}`);
        setOverwrite(true);
        setLastOp(null); // starting a new chain resets repeated-equals context
        return;
      }

      // No pending op: store current as prevValue and set pendingOp
      setPrevValue(current);
      setPendingOp(op);
      setPreviousLine(`${formatNumber(current)} ${opSymbol(op)}`);
      setOverwrite(true);
      setLastOp(null);
    },
    [
      compute,
      display,
      error,
      formatNumber,
      isFiniteNumber,
      overwrite,
      parseDisplayToNumber,
      pendingOp,
      prevValue,
      setErrorState,
    ]
  );

  const evaluateEquals = useCallback(() => {
    if (error) return;

    const current = parseDisplayToNumber(display);

    // If we have a pending op, compute with current rhs.
    if (pendingOp && prevValue !== null) {
      const result = compute(prevValue, pendingOp, current);
      if (!result.ok || !isFiniteNumber(result.value)) {
        setErrorState();
        return;
      }

      const formatted = formatNumber(result.value);
      const resultNum = Number(formatted);

      setDisplay(formatted);
      setPreviousLine(""); // result displayed; previous line can clear for clean look
      setPrevValue(resultNum);
      setPendingOp(null);
      setOverwrite(true);

      // Store last operation for repeated equals:
      setLastOp({ op: pendingOp, rhs: current });
      return;
    }

    // Repeated equals: apply lastOp to the current display value.
    if (!pendingOp && lastOp) {
      const lhs = parseDisplayToNumber(display);
      const result = compute(lhs, lastOp.op, lastOp.rhs);
      if (!result.ok || !isFiniteNumber(result.value)) {
        setErrorState();
        return;
      }

      const formatted = formatNumber(result.value);
      setDisplay(formatted);
      setOverwrite(true);
      return;
    }

    // If nothing to do, no-op.
    setOverwrite(true);
  }, [
    compute,
    display,
    error,
    formatNumber,
    isFiniteNumber,
    lastOp,
    parseDisplayToNumber,
    pendingOp,
    prevValue,
    setErrorState,
  ]);

  const opSymbol = (op) => {
    switch (op) {
      case "*":
        return "×";
      case "/":
        return "÷";
      case "+":
        return "+";
      case "-":
        return "−";
      default:
        return op;
    }
  };

  const handleButton = useCallback(
    (action) => {
      switch (action.type) {
        case "digit":
          inputDigit(action.value);
          break;
        case "decimal":
          inputDecimal();
          break;
        case "op":
          setOperator(action.value);
          break;
        case "equals":
          evaluateEquals();
          break;
        case "clear":
          clearAll();
          break;
        case "sign":
          toggleSign();
          break;
        case "percent":
          applyPercent();
          break;
        case "backspace":
          backspace();
          break;
        default:
          break;
      }
    },
    [applyPercent, backspace, clearAll, evaluateEquals, inputDecimal, inputDigit, setOperator, toggleSign]
  );

  // Keyboard support
  useEffect(() => {
    const onKeyDown = (e) => {
      // Avoid hijacking typing in inputs if any are added later.
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const { key } = e;

      // Digits
      if (/^\d$/.test(key)) {
        e.preventDefault();
        handleButton({ type: "digit", value: Number(key) });
        return;
      }

      // Decimal
      if (key === ".") {
        e.preventDefault();
        handleButton({ type: "decimal" });
        return;
      }

      // Operators
      if (key === "+" || key === "-") {
        e.preventDefault();
        handleButton({ type: "op", value: key });
        return;
      }
      if (key === "*" || key === "x" || key === "X") {
        e.preventDefault();
        handleButton({ type: "op", value: "*" });
        return;
      }
      if (key === "/") {
        e.preventDefault();
        handleButton({ type: "op", value: "/" });
        return;
      }

      // Percent
      if (key === "%") {
        e.preventDefault();
        handleButton({ type: "percent" });
        return;
      }

      // Equals
      if (key === "Enter" || key === "=") {
        e.preventDefault();
        handleButton({ type: "equals" });
        return;
      }

      // Clear
      if (key === "Escape") {
        e.preventDefault();
        handleButton({ type: "clear" });
        return;
      }

      // Backspace
      if (key === "Backspace") {
        e.preventDefault();
        handleButton({ type: "backspace" });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleButton]);

  // Focus container on mount for immediate keyboard usability
  useEffect(() => {
    if (containerRef.current) containerRef.current.focus();
  }, []);

  const buttonBase = {
    appearance: "none",
    border: `1px solid ${THEME.border}`,
    background: THEME.surface,
    color: THEME.text,
    borderRadius: 14,
    padding: "14px 10px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    transition: "transform 120ms ease, box-shadow 120ms ease, background 120ms ease, border-color 120ms ease",
    boxShadow: "0 2px 10px rgba(17, 24, 39, 0.06)",
    userSelect: "none",
  };

  const styles = {
    page: {
      minHeight: "100vh",
      background: `linear-gradient(180deg, ${THEME.background} 0%, rgba(37, 99, 235, 0.06) 60%, ${THEME.background} 100%)`,
      display: "grid",
      placeItems: "center",
      padding: 24,
      color: THEME.text,
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji'",
    },
    shell: {
      width: "min(420px, 100%)",
      background: THEME.surface,
      border: `1px solid ${THEME.border}`,
      borderRadius: 22,
      boxShadow: THEME.shadow,
      overflow: "hidden",
    },
    header: {
      padding: "18px 18px 8px 18px",
      background: `linear-gradient(135deg, rgba(37, 99, 235, 0.10), rgba(245, 158, 11, 0.10))`,
      borderBottom: `1px solid ${THEME.border}`,
    },
    titleRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 10,
    },
    brand: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontWeight: 800,
      letterSpacing: "-0.02em",
    },
    dot: {
      width: 12,
      height: 12,
      borderRadius: 999,
      background: `linear-gradient(135deg, ${THEME.primary}, ${THEME.secondary})`,
      boxShadow: "0 6px 18px rgba(37, 99, 235, 0.25)",
    },
    hint: {
      fontSize: 12,
      color: THEME.subtle,
      textAlign: "right",
      lineHeight: 1.2,
    },
    displayWrap: {
      background: THEME.surface,
      border: `1px solid ${THEME.border}`,
      borderRadius: 18,
      padding: "14px 14px 12px 14px",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)",
    },
    previousLine: {
      fontSize: 12,
      fontWeight: 600,
      color: error ? THEME.error : "rgba(17, 24, 39, 0.55)",
      minHeight: 18,
      textAlign: "right",
      letterSpacing: "0.02em",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    mainDisplay: {
      fontSize: 34,
      fontWeight: 800,
      textAlign: "right",
      letterSpacing: "-0.02em",
      lineHeight: 1.15,
      marginTop: 6,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      color: error ? THEME.error : THEME.text,
    },
    keypad: {
      padding: 16,
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 12,
      background: THEME.background,
    },
    btn: buttonBase,
    btnPrimary: {
      ...buttonBase,
      background: THEME.primary,
      borderColor: "rgba(37, 99, 235, 0.35)",
      color: "#fff",
      boxShadow: "0 10px 20px rgba(37, 99, 235, 0.22)",
    },
    btnAccent: {
      ...buttonBase,
      background: THEME.secondary,
      borderColor: "rgba(245, 158, 11, 0.35)",
      color: "#111827",
      boxShadow: "0 10px 20px rgba(245, 158, 11, 0.22)",
    },
    btnDanger: {
      ...buttonBase,
      background: "rgba(239, 68, 68, 0.10)",
      borderColor: "rgba(239, 68, 68, 0.35)",
      color: THEME.error,
      boxShadow: "0 10px 20px rgba(239, 68, 68, 0.10)",
    },
    btnWide: {
      gridColumn: "span 2",
    },
    footer: {
      padding: "0 16px 16px 16px",
      background: THEME.background,
      color: "rgba(17, 24, 39, 0.55)",
      fontSize: 12,
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "center",
    },
    kbd: {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: 11,
      padding: "2px 6px",
      borderRadius: 8,
      border: `1px solid ${THEME.border}`,
      background: THEME.surface,
      color: THEME.text,
    },
  };

  const makePressHandlers = (action) => ({
    onClick: () => handleButton(action),
    onMouseDown: (e) => {
      // Prevent focus loss / text selection.
      e.preventDefault();
    },
  });

  const Button = ({ label, ariaLabel, style, action }) => (
    <button
      type="button"
      style={style}
      aria-label={ariaLabel ?? label}
      {...makePressHandlers(action)}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = "0 10px 22px rgba(17, 24, 39, 0.10)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = style.boxShadow || buttonBase.boxShadow;
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = `3px solid rgba(37, 99, 235, 0.25)`;
        e.currentTarget.style.outlineOffset = "2px";
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = "none";
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={styles.page}>
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label="Calculator"
        style={styles.shell}
      >
        <div style={styles.header}>
          <div style={styles.titleRow}>
            <div style={styles.brand}>
              <span aria-hidden="true" style={styles.dot} />
              <span>Ocean Calculator</span>
            </div>
            <div style={styles.hint}>
              Keyboard: <span style={styles.kbd}>0-9</span> <span style={styles.kbd}>+ - * /</span>{" "}
              <span style={styles.kbd}>Enter</span> <span style={styles.kbd}>Esc</span>
            </div>
          </div>

          <div style={styles.displayWrap} aria-live="polite">
            <div style={styles.previousLine}>{previousLine}</div>
            <div style={styles.mainDisplay}>{display}</div>
          </div>
        </div>

        <div style={styles.keypad}>
          <Button label="AC" ariaLabel="Clear all" style={styles.btnDanger} action={{ type: "clear" }} />
          <Button label="±" ariaLabel="Toggle sign" style={styles.btn} action={{ type: "sign" }} />
          <Button label="%" ariaLabel="Percent" style={styles.btn} action={{ type: "percent" }} />
          <Button label="÷" ariaLabel="Divide" style={styles.btnAccent} action={{ type: "op", value: "/" }} />

          <Button label="7" style={styles.btn} action={{ type: "digit", value: 7 }} />
          <Button label="8" style={styles.btn} action={{ type: "digit", value: 8 }} />
          <Button label="9" style={styles.btn} action={{ type: "digit", value: 9 }} />
          <Button label="×" ariaLabel="Multiply" style={styles.btnAccent} action={{ type: "op", value: "*" }} />

          <Button label="4" style={styles.btn} action={{ type: "digit", value: 4 }} />
          <Button label="5" style={styles.btn} action={{ type: "digit", value: 5 }} />
          <Button label="6" style={styles.btn} action={{ type: "digit", value: 6 }} />
          <Button label="−" ariaLabel="Subtract" style={styles.btnAccent} action={{ type: "op", value: "-" }} />

          <Button label="1" style={styles.btn} action={{ type: "digit", value: 1 }} />
          <Button label="2" style={styles.btn} action={{ type: "digit", value: 2 }} />
          <Button label="3" style={styles.btn} action={{ type: "digit", value: 3 }} />
          <Button label="+" ariaLabel="Add" style={styles.btnAccent} action={{ type: "op", value: "+" }} />

          <Button label="0" style={{ ...styles.btn, ...styles.btnWide }} action={{ type: "digit", value: 0 }} />
          <Button label="." ariaLabel="Decimal" style={styles.btn} action={{ type: "decimal" }} />
          <Button label="=" ariaLabel="Equals" style={styles.btnPrimary} action={{ type: "equals" }} />
        </div>

        <div style={styles.footer}>
          <div>
            Tip: <span style={styles.kbd}>Backspace</span> to delete
          </div>
          <button
            type="button"
            style={{
              ...buttonBase,
              padding: "8px 10px",
              fontSize: 12,
              fontWeight: 700,
              background: THEME.surface,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleButton({ type: "backspace" })}
            aria-label="Backspace"
            title="Backspace"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
