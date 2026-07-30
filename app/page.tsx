import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  CURRICULUM_ROADMAP,
  WORLD_CATALOG,
} from "@/worlds/catalog";
import styles from "./GardenHub.module.css";

export const metadata: Metadata = {
  title: "Flower Garden · 월드 선택",
  description:
    "Flower의 핵심 실행부터 Signal과 Timeout까지, 실제 Runtime을 3D 세계로 투영해 배우는 플레이 가능한 커리큘럼.",
};

export default function Home() {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Flower Garden 홈">
          <span className={styles.brandMark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className={styles.brandCopy}>
            <strong>Flower Garden</strong>
            <small>실행하며 배우는 Flower microworld</small>
          </span>
        </Link>
        <span className={styles.libraryBadge}>
          <i aria-hidden="true" />
          {WORLD_CATALOG.length} WORLDS PLAYABLE
        </span>
      </header>

      <section className={styles.hero} aria-labelledby="garden-title">
        <div>
          <p className={styles.eyebrow}>WORLD LIBRARY · CORE FIRST</p>
          <h1 id="garden-title">
            Flower의 핵심부터,
            <br />
            세계 하나씩.
          </h1>
          <p className={styles.heroLead}>
            설명서를 외우기 전에 직접 조립하고 실행해 보세요. 각 월드는
            실제 Flower Runtime의 한 가지 개념을 손으로 다루게 하고, 다음
            월드에서 그 위에 새로운 부품을 더합니다.
          </p>
        </div>

        <aside className={styles.truthPanel} aria-label="Flower Garden 실행 원칙">
          <span>ONE SOURCE OF TRUTH</span>
          <div className={styles.truthFlow}>
            <strong>실제 Flower Runtime</strong>
            <i aria-hidden="true" />
            <strong>실행 이벤트 · 상태 변경 기록</strong>
            <i aria-hidden="true" />
            <strong>World Projection</strong>
            <i aria-hidden="true" />
            <strong>3D 게임 세계</strong>
          </div>
          <p className={styles.truthNote}>
            게임 화면은 결과를 만들지 않습니다. Flower가 만든 trace를
            이해하기 쉬운 세계로 보여줍니다.
          </p>
        </aside>
      </section>

      <section className={styles.worldsSection} aria-labelledby="playable-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>CHOOSE A WORLD</p>
            <h2 id="playable-title">플레이할 게임을 고르세요</h2>
          </div>
          <p>
            처음이라면 01부터 시작하세요. 월드 카드는 배우는 개념, 예상
            시간, 선행 지식을 미리 보여줍니다.
          </p>
        </div>

        <div className={styles.worldGrid}>
          {WORLD_CATALOG.map((world, index) => {
            const mission = world.manifest.missions[0];

            return (
              <article
                className={styles.worldCard}
                data-accent={world.accent}
                key={world.manifest.id}
              >
                <Link
                  className={styles.worldLink}
                  href={world.href}
                  prefetch={false}
                  aria-label={`${world.manifest.displayName}, ${mission.displayName} 플레이`}
                >
                  <div className={styles.cover}>
                    <Image
                      src={world.coverImage}
                      alt={`${world.manifest.displayName} voxel 게임 세계`}
                      fill
                      priority={index === 0}
                      sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1480px) 46vw, 660px"
                    />
                    <span className={styles.coverTop}>
                      <i aria-hidden="true" />
                      PLAYABLE
                    </span>
                    <span className={styles.worldNumber}>
                      WORLD {String(world.manifest.catalogOrder).padStart(2, "0")}
                    </span>
                  </div>

                  <div className={styles.cardBody}>
                    <p className={styles.chapter}>{world.chapter}</p>
                    <h3>{world.manifest.displayName}</h3>
                    <p className={styles.missionName}>
                      Mission · {mission.displayName}
                    </p>
                    <p className={styles.summary}>{world.summary}</p>

                    <div
                      className={styles.conceptChain}
                      aria-label="학습 개념 순서"
                    >
                      {world.concepts.map((concept, conceptIndex) => (
                        <span key={concept}>
                          {conceptIndex > 0 && (
                            <i aria-hidden="true">→&nbsp;</i>
                          )}
                          {concept}
                        </span>
                      ))}
                    </div>

                    <div className={styles.facts} aria-label="월드 정보">
                      <span>난이도 {world.difficulty}</span>
                      <span>{world.estimatedMinutes}</span>
                      <span>{world.scenarioLabel}</span>
                      <span>
                        {world.prerequisites.length === 0
                          ? "선행 학습 없음"
                          : "01 권장"}
                      </span>
                    </div>

                    <ul className={styles.highlights}>
                      {world.learningHighlights.map((highlight) => (
                        <li key={highlight}>{highlight}</li>
                      ))}
                    </ul>

                    <div className={styles.playRow}>
                      <span>이 월드 플레이하기</span>
                      <b aria-hidden="true">→</b>
                    </div>
                  </div>
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.roadmapSection} aria-labelledby="roadmap-title">
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>CURRICULUM ROADMAP</p>
            <h2 id="roadmap-title">다음에 열릴 정원</h2>
          </div>
          <p>
            Core → Waiting → Durability → Operations → Reliability → Design
            순서로 인식 부채를 줄입니다.
          </p>
        </div>

        <div className={styles.roadmap}>
          {CURRICULUM_ROADMAP.map((world) => (
            <article className={styles.roadmapItem} key={world.order}>
              <span className={styles.roadmapOrder}>
                {String(world.order).padStart(2, "0")}
              </span>
              <small>{world.chapter} · PLANNED</small>
              <h3>{world.title}</h3>
              <p className={styles.roadmapConcepts}>{world.concepts}</p>
              <p className={styles.roadmapDescription}>{world.description}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className={styles.footer}>
        <strong>One garden. One shared Flower Runtime gateway.</strong>
        <span>새 월드는 독립 모듈로 추가되고 이 라이브러리에 등록됩니다.</span>
      </footer>
    </main>
  );
}
