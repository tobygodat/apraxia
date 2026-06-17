import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Book, Draft, Movie, Todo, Writing } from "../types";
import "./OrbitHome.css";

interface Props {
  accent?: string;
  wordmark?: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function OrbitHome({
  accent = "#ededed",
  wordmark = "/orbitOS/",
}: Props) {
  const navigate = useNavigate();
  const [footerText, setFooterText] = useState("5 collections in orbit");

  useEffect(() => {
    Promise.all([
      api.list<Todo>("todos").catch(() => [] as Todo[]),
      api.list<Book>("books").catch(() => [] as Book[]),
      api.list<Writing>("writing").catch(() => [] as Writing[]),
      api.list<Movie>("movies").catch(() => [] as Movie[]),
      api.list<Draft>("drafts").catch(() => [] as Draft[]),
    ])
      .then(([todos, books, writings, movies, drafts]) => {
        // Collect all timestamps — drafts only have created_at
        const timestamps: string[] = [
          ...todos.map((r) => r.updated_at ?? r.created_at),
          ...books.map((r) => r.updated_at ?? r.created_at),
          ...writings.map((r) => r.updated_at ?? r.created_at),
          ...movies.map((r) => r.updated_at ?? r.created_at),
          ...drafts.map((r) => r.created_at),
        ].filter(Boolean);

        if (timestamps.length === 0) {
          setFooterText("5 collections in orbit");
          return;
        }

        // Most-recent timestamp
        const latest = timestamps.reduce((a, b) => (a > b ? a : b));
        const rel = relativeTime(latest);
        setFooterText(`5 collections in orbit · synced ${rel}`);
      })
      .catch(() => {
        setFooterText("5 collections in orbit");
      });
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#161618",
        fontFamily: "'Space Grotesk', sans-serif",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <header
        style={{
          height: "64px",
          flexShrink: 0,
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 36px",
          zIndex: 5,
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "18px",
            fontWeight: 500,
            color: accent,
          }}
        >
          {wordmark}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "22px" }}>
          <span
            className="orbit-add"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
              color: "rgba(255,255,255,0.4)",
              letterSpacing: "0.04em",
              cursor: "pointer",
              transition: "color 0.15s",
            }}
            onClick={() => {/* no-op hook */}}
          >
            + add
          </span>
          <span
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              background: "rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
              color: "rgba(255,255,255,0.7)",
            }}
          >
            xc
          </span>
        </div>
      </header>

      {/* Main */}
      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          position: "relative",
        }}
      >
        {/* Starfield */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          <div style={{ position: "absolute", left: "8%", top: "15%", width: "2px", height: "2px", borderRadius: "50%", background: "rgba(255,255,255,0.22)" }} />
          <div style={{ position: "absolute", left: "16%", top: "64%", width: "1px", height: "1px", borderRadius: "50%", background: "rgba(255,255,255,0.16)" }} />
          <div style={{ position: "absolute", left: "25%", top: "30%", width: "2px", height: "2px", borderRadius: "50%", background: "rgba(255,255,255,0.18)" }} />
          <div style={{ position: "absolute", left: "34%", top: "85%", width: "1px", height: "1px", borderRadius: "50%", background: "rgba(255,255,255,0.14)" }} />
          <div style={{ position: "absolute", left: "46%", top: "10%", width: "2px", height: "2px", borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
          <div style={{ position: "absolute", left: "62%", top: "80%", width: "1px", height: "1px", borderRadius: "50%", background: "rgba(255,255,255,0.15)" }} />
          <div style={{ position: "absolute", left: "69%", top: "18%", width: "2px", height: "2px", borderRadius: "50%", background: "rgba(255,255,255,0.22)" }} />
          <div style={{ position: "absolute", left: "74%", top: "58%", width: "1px", height: "1px", borderRadius: "50%", background: "rgba(255,255,255,0.16)" }} />
          <div style={{ position: "absolute", left: "82%", top: "38%", width: "2px", height: "2px", borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
          <div style={{ position: "absolute", left: "90%", top: "72%", width: "2px", height: "2px", borderRadius: "50%", background: "rgba(255,255,255,0.17)" }} />
          <div style={{ position: "absolute", left: "93%", top: "24%", width: "1px", height: "1px", borderRadius: "50%", background: "rgba(255,255,255,0.14)" }} />
          <div style={{ position: "absolute", left: "51%", top: "93%", width: "1px", height: "1px", borderRadius: "50%", background: "rgba(255,255,255,0.15)" }} />
        </div>

        {/* Stage — 560×560, scaleY(0.8) */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "560px",
            height: "560px",
            transform: "scaleY(0.8)",
            transformOrigin: "center",
          }}
        >
          {/* Rings */}
          <div style={{ position: "absolute", left: "50%", top: "50%", width: "180px", height: "180px", marginLeft: "-90px", marginTop: "-90px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", left: "50%", top: "50%", width: "280px", height: "280px", marginLeft: "-140px", marginTop: "-140px", border: "1px solid rgba(255,255,255,0.16)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", left: "50%", top: "50%", width: "400px", height: "400px", marginLeft: "-200px", marginTop: "-200px", border: "1px solid rgba(255,255,255,0.13)", borderRadius: "50%" }} />
          <div style={{ position: "absolute", left: "50%", top: "50%", width: "520px", height: "520px", marginLeft: "-260px", marginTop: "-260px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "50%" }} />

          {/* Sun / core */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "64px",
              height: "64px",
              marginLeft: "-32px",
              marginTop: "-32px",
              borderRadius: "50%",
              background: `radial-gradient(circle at 42% 38%, #ffffff 0%, ${accent} 62%, ${accent} 100%)`,
              boxShadow: "0 0 30px 6px rgba(255,255,255,0.13), 0 0 12px 2px rgba(255,255,255,0.26)",
              transform: "scaleY(1.25)",
              animation: "corepulse 4s ease-in-out infinite",
              zIndex: 2,
            }}
          />

          {/* TODOS · ring 2 (280px), delay 0s */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "280px",
              height: "280px",
              marginLeft: "-140px",
              marginTop: "-140px",
              animation: "orbit 220s linear 0s infinite",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                width: "140px",
                height: "92px",
                marginLeft: "-70px",
                marginTop: "-46px",
              }}
            >
              <div
                className="orbit-planet"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "14px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  cursor: "pointer",
                  animation: "orbitrev 220s linear 0s infinite",
                }}
                onClick={() => navigate("/todos")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/todos");
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label="todos"
              >
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "96px",
                    height: "46px",
                    transform: "scaleY(1.25)",
                  }}
                >
                  <div style={{ position: "absolute", width: "50px", height: "14px", borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.22)", transform: "rotate(-14deg)" }} />
                  <div
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 62% 64%, rgba(0,0,0,0.05) 0 5px, transparent 9px), radial-gradient(circle at 34% 30%, #f5f5f6 0%, #cfcfd2 50%, #949498 100%)",
                      boxShadow: "0 0 10px 1px rgba(255,255,255,0.14), inset -3px -4px 7px rgba(0,0,0,0.48)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "16px",
                    color: "rgba(255,255,255,0.92)",
                    display: "inline-block",
                    transform: "scaleY(1.25)",
                  }}
                >
                  todos
                </span>
              </div>
            </div>
          </div>

          {/* BOOKS · ring 3 (400px), delay -44s */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "400px",
              height: "400px",
              marginLeft: "-200px",
              marginTop: "-200px",
              animation: "orbit 220s linear -44s infinite",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                width: "140px",
                height: "92px",
                marginLeft: "-70px",
                marginTop: "-46px",
              }}
            >
              <div
                className="orbit-planet"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "14px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  cursor: "pointer",
                  animation: "orbitrev 220s linear -44s infinite",
                }}
                onClick={() => navigate("/books")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/books");
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label="books"
              >
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "96px",
                    height: "46px",
                    transform: "scaleY(1.25)",
                  }}
                >
                  <div style={{ position: "absolute", width: "64px", height: "20px", borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.3)", transform: "rotate(-24deg)" }} />
                  <div style={{ position: "absolute", width: "50px", height: "15px", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.16)", transform: "rotate(-24deg)" }} />
                  <div
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      background: "repeating-linear-gradient(7deg, rgba(0,0,0,0.05) 0 3px, rgba(0,0,0,0) 3px 7px), radial-gradient(circle at 34% 30%, #f0efec 0%, #cac6c0 50%, #8d8984 100%)",
                      boxShadow: "0 0 10px 1px rgba(255,255,255,0.13), inset -3px -4px 7px rgba(0,0,0,0.5)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "16px",
                    color: "rgba(255,255,255,0.92)",
                    display: "inline-block",
                    transform: "scaleY(1.25)",
                  }}
                >
                  books
                </span>
              </div>
            </div>
          </div>

          {/* WRITING (notes) · ring 3 (400px), delay -132s */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "400px",
              height: "400px",
              marginLeft: "-200px",
              marginTop: "-200px",
              animation: "orbit 220s linear -132s infinite",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                width: "140px",
                height: "92px",
                marginLeft: "-70px",
                marginTop: "-46px",
              }}
            >
              <div
                className="orbit-planet"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "14px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  cursor: "pointer",
                  animation: "orbitrev 220s linear -132s infinite",
                }}
                onClick={() => navigate("/writing")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/writing");
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label="writing"
              >
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "96px",
                    height: "46px",
                    transform: "scaleY(1.25)",
                  }}
                >
                  <div style={{ position: "absolute", width: "62px", height: "18px", borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.24)", transform: "rotate(18deg)" }} />
                  <div
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 66% 40%, rgba(255,255,255,0.08) 0 4px, transparent 8px), radial-gradient(circle at 34% 30%, #eaebed 0%, #babdc3 50%, #7f828a 100%)",
                      boxShadow: "0 0 10px 1px rgba(255,255,255,0.13), inset -3px -4px 7px rgba(0,0,0,0.5)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "16px",
                    color: "rgba(255,255,255,0.92)",
                    display: "inline-block",
                    transform: "scaleY(1.25)",
                  }}
                >
                  writing
                </span>
              </div>
            </div>
          </div>

          {/* MOVIES · ring 4 (520px), delay -88s */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "520px",
              height: "520px",
              marginLeft: "-260px",
              marginTop: "-260px",
              animation: "orbit 220s linear -88s infinite",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                width: "140px",
                height: "92px",
                marginLeft: "-70px",
                marginTop: "-46px",
              }}
            >
              <div
                className="orbit-planet"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "14px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  cursor: "pointer",
                  animation: "orbitrev 220s linear -88s infinite",
                }}
                onClick={() => navigate("/movies")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/movies");
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label="movies"
              >
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "96px",
                    height: "46px",
                    transform: "scaleY(1.25)",
                  }}
                >
                  <div style={{ position: "absolute", width: "72px", height: "22px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.26)", transform: "rotate(28deg)" }} />
                  <div
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 58% 44%, rgba(0,0,0,0.07) 0 2px, transparent 3px), radial-gradient(circle at 44% 64%, rgba(0,0,0,0.06) 0 2px, transparent 3px), radial-gradient(circle at 70% 62%, rgba(0,0,0,0.05) 0 1.5px, transparent 2.5px), radial-gradient(circle at 34% 30%, #efefef 0%, #c2c2c4 50%, #88888c 100%)",
                      boxShadow: "0 0 10px 1px rgba(255,255,255,0.13), inset -3px -4px 7px rgba(0,0,0,0.5)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "16px",
                    color: "rgba(255,255,255,0.92)",
                    display: "inline-block",
                    transform: "scaleY(1.25)",
                  }}
                >
                  movies
                </span>
              </div>
            </div>
          </div>

          {/* DRAFTS (people) · ring 4 (520px), delay -176s */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "520px",
              height: "520px",
              marginLeft: "-260px",
              marginTop: "-260px",
              animation: "orbit 220s linear -176s infinite",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                width: "140px",
                height: "92px",
                marginLeft: "-70px",
                marginTop: "-46px",
              }}
            >
              <div
                className="orbit-planet"
                style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "14px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  cursor: "pointer",
                  animation: "orbitrev 220s linear -176s infinite",
                }}
                onClick={() => navigate("/drafts")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("/drafts");
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label="drafts"
              >
                <div
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "96px",
                    height: "46px",
                    transform: "scaleY(1.25)",
                  }}
                >
                  <div style={{ position: "absolute", width: "60px", height: "16px", borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.24)", transform: "rotate(6deg)" }} />
                  <div style={{ position: "absolute", width: "46px", height: "12px", borderRadius: "50%", border: "1px solid rgba(255,255,255,0.13)", transform: "rotate(6deg)" }} />
                  <div
                    style={{
                      width: "26px",
                      height: "26px",
                      borderRadius: "50%",
                      background: "radial-gradient(circle at 60% 46%, rgba(255,255,255,0.07) 0 4px, transparent 8px), radial-gradient(circle at 38% 64%, rgba(0,0,0,0.06) 0 4px, transparent 7px), radial-gradient(circle at 34% 30%, #f1ece8 0%, #cbc3bb 50%, #8f867d 100%)",
                      boxShadow: "0 0 10px 1px rgba(255,255,255,0.13), inset -3px -4px 7px rgba(0,0,0,0.5)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "16px",
                    color: "rgba(255,255,255,0.92)",
                    display: "inline-block",
                    transform: "scaleY(1.25)",
                  }}
                >
                  drafts
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          flexShrink: 0,
          padding: "22px 36px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "11px",
            color: "rgba(255,255,255,0.25)",
            letterSpacing: "0.08em",
          }}
        >
          {footerText}
        </span>
      </footer>
    </div>
  );
}
