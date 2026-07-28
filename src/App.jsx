import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";
import "./header-fix.css";
import { useAuth } from "./hooks/useAuth";
import { loadKujiProjects, syncKujiProjects } from "./services/kuji";
import { deletePrizeImage, uploadPrizeDataUrl, uploadPrizeImage } from "./services/prizeStorage";


const DEFAULT_PRIZES = [
  {
    id: 1,
    name: "151 일본판 박스",
    grade: "PSA 10 · 미개봉",
    total: 4,
    remaining: 4,
  },
  {
    id: 2,
    name: "초전브레이커 일본판 박스",
    grade: "PSA 10 · 미개봉",
    total: 3,
    remaining: 3,
  },
  {
    id: 3,
    name: "인페르노X 일본판 박스",
    grade: "PSA 10 · 미개봉",
    total: 5,
    remaining: 5,
  },
  {
    id: 4,
    name: "테라스탈페스 일본판 박스",
    grade: "PSA 10 · 미개봉",
    total: 5,
    remaining: 5,
  },
  {
    id: 5,
    name: "메가드림 일본판 박스",
    grade: "PSA 10 · 미개봉",
    total: 5,
    remaining: 5,
  },
];

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function shuffleArray(items) {
  const copiedItems = [...items];

  for (let index = copiedItems.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));

    [copiedItems[index], copiedItems[randomIndex]] = [
      copiedItems[randomIndex],
      copiedItems[index],
    ];
  }

  return copiedItems;
}

const RANDOM_DRAW_LOCK_PREFIX = "luckykujiRandomDrawLock:";

function getRandomDrawLockKey(kujiId) {
  return `${RANDOM_DRAW_LOCK_PREFIX}${kujiId || "kuji-default"}`;
}

function readRandomDrawLock(kujiId) {
  try {
    const saved = JSON.parse(localStorage.getItem(getRandomDrawLockKey(kujiId)));
    if (!saved || !Array.isArray(saved.numbers) || saved.numbers.length < 1) {
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function writeRandomDrawLock(kujiId, lock) {
  localStorage.setItem(getRandomDrawLockKey(kujiId), JSON.stringify(lock));
}

function clearRandomDrawLock(kujiId) {
  localStorage.removeItem(getRandomDrawLockKey(kujiId));
}

function getSavedArray(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));

    return Array.isArray(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}


function removeResultImage(result) {
  if (!result || typeof result !== "object") return result;
  const { image, ...rest } = result;
  return rest;
}

function compactPrizeMapForStorage(prizeMap) {
  if (!prizeMap || typeof prizeMap !== "object" || Array.isArray(prizeMap)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(prizeMap).map(([number, result]) => [
      number,
      removeResultImage(result),
    ]),
  );
}

function compactHistoryForStorage(history) {
  if (!Array.isArray(history)) return [];

  return history.map((entry) => ({
    ...entry,
    results: Array.isArray(entry.results)
      ? entry.results.map(removeResultImage)
      : [],
  }));
}

function compactKujiForStorage(kuji) {
  return {
    ...kuji,
    history: compactHistoryForStorage(kuji?.history),
    prizeMap: compactPrizeMapForStorage(kuji?.prizeMap),
  };
}

function saveKujiListSafely(kujiList, activeKujiId = "") {
  const compactList = Array.isArray(kujiList)
    ? kujiList.map(compactKujiForStorage)
    : [];

  try {
    localStorage.setItem("luckykujiKujiList", JSON.stringify(compactList));
    return compactList;
  } catch (error) {
    const isQuotaError =
      error?.name === "QuotaExceededError" ||
      error?.name === "NS_ERROR_DOM_QUOTA_REACHED";

    if (!isQuotaError) throw error;

    const reducedList = compactList.map((kuji) => {
      if (kuji.id === activeKujiId) return kuji;

      return {
        ...kuji,
        prizes: Array.isArray(kuji.prizes)
          ? kuji.prizes.map((prize) => ({ ...prize, image: "" }))
          : [],
        prizeMap: {},
      };
    });

    try {
      localStorage.setItem("luckykujiKujiList", JSON.stringify(reducedList));
      return reducedList;
    } catch (secondError) {
      console.warn("쿠지 목록 저장 공간이 부족합니다.", secondError);
      return compactList;
    }
  }
}


const AUTO_BACKUP_STORAGE_KEY = "luckykujiAutoBackups";
const AUTO_BACKUP_LIMIT = 30;
const AUTO_BACKUP_INTERVAL_MS = 5 * 60 * 1000;

function readAutoBackups() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_BACKUP_STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function writeAutoBackup(kujiList, activeKujiId, reason = "자동") {
  const projects = Array.isArray(kujiList)
    ? kujiList.map(compactKujiForStorage)
    : [];

  if (projects.length === 0) return null;

  const backup = {
    id: `backup-${Date.now()}`,
    createdAt: new Date().toISOString(),
    createdAtLabel: new Date().toLocaleString("ko-KR"),
    reason,
    activeKujiId,
    projects,
  };

  try {
    const previous = readAutoBackups();
    const latest = previous[0];
    const sameData =
      latest &&
      JSON.stringify(latest.projects) === JSON.stringify(projects) &&
      latest.activeKujiId === activeKujiId;

    if (sameData) return latest;

    localStorage.setItem(
      AUTO_BACKUP_STORAGE_KEY,
      JSON.stringify([backup, ...previous].slice(0, AUTO_BACKUP_LIMIT)),
    );
    return backup;
  } catch (error) {
    console.warn("자동 백업 저장 실패:", error);
    return null;
  }
}

function readPrizeImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("이미지 파일을 선택해 주세요."));
      return;
    }

    if (!String(file.type || "").startsWith("image/")) {
      reject(new Error("이미지 파일만 등록할 수 있습니다."));
      return;
    }

    // localStorage 용량 초과를 막기 위해 이미지 크기를 제한합니다.
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error("이미지는 2MB 이하 파일을 사용해 주세요."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

const PRIZE_ACCENTS = [
  "cyan",
  "violet",
  "gold",
  "rose",
  "emerald",
  "orange",
  "blue",
  "pink",
];

function getPrizeAccent(prize, index = 0) {  return PRIZE_ACCENTS[index % PRIZE_ACCENTS.length];
}

function getPrizeRarity(prize) {
  // 상품 관리에서 직접 지정한 희귀도를 가장 우선으로 사용합니다.
  const savedRarity = String(prize.rarity || "").toUpperCase();
  const allowedRarities = ["S", "A", "B", "C"];

  if (allowedRarities.includes(savedRarity)) {
    return {
      rarity: savedRarity,
      stars:
        savedRarity === "S"
          ? 5
          : savedRarity === "A"
            ? 4
            : savedRarity === "B"
              ? 3
              : 2,
    };
  }

  // 기존에 저장된 상품은 이전 방식으로 자동 계산합니다.
  const scarcity = prize.total > 0 ? prize.remaining / prize.total : 1;
  const gradeText = String(prize.grade || "").toUpperCase();
  const rarity = gradeText.includes("PSA 10")
    ? scarcity <= 0.35
      ? "S"
      : "A"
    : gradeText.includes("PSA 9")
      ? "A"
      : "B";

  return {
    rarity,
    stars: rarity === "S" ? 5 : rarity === "A" ? 4 : 3,
  };
}

function createPrizeAssignment(totalNumbers, prizes) {
  const safeTotalNumbers = Number(totalNumbers);

  if (
    !Number.isInteger(safeTotalNumbers) ||
    safeTotalNumbers <= 0 ||
    !Array.isArray(prizes) ||
    prizes.length === 0
  ) {
    return null;
  }

  const hasInvalidPrizeQuantity = prizes.some((prize) => {
    const total = Number(prize.total);
    const remaining = Number(prize.remaining);

    return (
      !Number.isInteger(total) ||
      !Number.isInteger(remaining) ||
      total < 0 ||
      remaining < 0 ||
      total !== remaining
    );
  });

  if (hasInvalidPrizeQuantity) {
    return null;
  }

  const totalPrizeQuantity = prizes.reduce(
    (sum, prize) => sum + Number(prize.total),
    0,
  );
  const remainingPrizeQuantity = prizes.reduce(
    (sum, prize) => sum + Number(prize.remaining),
    0,
  );

  if (
    totalPrizeQuantity !== safeTotalNumbers ||
    remainingPrizeQuantity !== safeTotalNumbers
  ) {
    return null;
  }

  const prizePool = prizes.flatMap((prize) =>
    Array.from(
      { length: Number(prize.total) },
      () => ({
        prizeId: prize.id,
        prizeName: prize.name,
        grade: prize.grade,
        image: prize.image || "",
      }),
    ),
  );

  if (prizePool.length !== safeTotalNumbers) {
    return null;
  }

  const shuffledNumbers = shuffleArray(
    Array.from({ length: totalNumbers }, (_, index) => index + 1),
  );
  const shuffledPrizes = shuffleArray(prizePool);
  const assignment = {};

  shuffledNumbers.forEach((number, index) => {
    const prize = shuffledPrizes[index];
    const originalPrize = prizes.find((item) => item.id === prize.prizeId);
    const { rarity, stars } = getPrizeRarity(
      originalPrize || {
        ...prize,
        total: 1,
        remaining: 1,
      },
    );

    assignment[number] = {
      number,
      prizeId: prize.prizeId,
      prizeName: prize.prizeName,
      grade: prize.grade,
      rarity,
      stars,
      // 이미지는 prizes에서 조회하므로 번호별 배치에는 중복 저장하지 않습니다.
    };
  });

  return assignment;
}

function getAssignedResults(numbers, prizeMap, prizes = []) {
  return numbers
    .map((number) => prizeMap[String(number)] || prizeMap[number])
    .filter(Boolean)
    .map((result) => {
      const originalPrize = prizes.find(
        (prize) => String(prize.id) === String(result.prizeId),
      );

      return {
        ...result,
        image: result.image || originalPrize?.image || "",
      };
    });
}

function buildLockedResults(numbers, prizes) {
  const quantitySafePool = shuffleArray(
    prizes.flatMap((prize) =>
      Array.from(
        { length: Math.max(0, Number(prize.remaining) || 0) },
        () => prize,
      ),
    ),
  );

  return numbers.map((number, index) => {
    const prize =
      quantitySafePool[index] || null;

    const { rarity, stars } = getPrizeRarity(prize);

    return {
      number,
      prizeId: prize.id,
      prizeName: prize.name,
      grade: prize.grade,
      rarity,
      stars,
      image: prize.image || "",
    };
  });
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (event) => {
    event.preventDefault();

    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      setError("이메일과 비밀번호를 모두 입력해 주세요.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");
      await onLogin(cleanEmail, password);
    } catch (loginError) {
      console.error("관리자 로그인 실패:", loginError);
      setError(
        loginError?.message === "Invalid login credentials"
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
          : loginError?.message || "로그인 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleLogin}>
        <div className="login-logo">LK</div>

        <p className="small-label">PRIVATE CONTROL PANEL</p>
        <h1>LuckyKuji</h1>

        <p className="login-description">
          Supabase 관리자 계정으로 로그인해 주세요.
        </p>

        <label>
          이메일
          <input
            type="email"
            value={email}
            autoComplete="email"
            onChange={(event) => {
              setEmail(event.target.value);
              setError("");
            }}
            placeholder="관리자 이메일"
            disabled={isSubmitting}
          />
        </label>

        <label>
          비밀번호
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
            placeholder="관리자 비밀번호"
            disabled={isSubmitting}
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button
          type="submit"
          className="login-button"
          disabled={isSubmitting}
        >
          {isSubmitting ? "로그인 확인 중..." : "관리자 로그인"}
        </button>

        <p className="login-hint">
          계정은 Supabase Authentication에서만 관리됩니다.
        </p>
      </form>
    </main>
  );
}

function LivePage({ onLogout, user }) {
  const isManagePage = window.location.pathname.startsWith("/manage");
  const [roundTitle, setRoundTitle] = useState(
    () => localStorage.getItem("luckykujiRoundTitle") || "제1회 럭키쿠지",
  );

  const [account, setAccount] = useState(
    () =>
      localStorage.getItem("luckykujiAccount") ||
      "케이뱅크 100-204-176636",
  );

  const [price, setPrice] = useState(
    () => Number(localStorage.getItem("luckykujiPrice")) || 28000,
  );

  const [totalNumbers, setTotalNumbers] = useState(
    () => Number(localStorage.getItem("luckykujiTotalNumbers")) || 666,
  );

  const [usedNumbers, setUsedNumbers] = useState(() =>
    getSavedArray("luckykujiUsedNumbers", []),
  );

  const [history, setHistory] = useState(() =>
    getSavedArray("luckykujiHistory", []),
  );

  const [prizes, setPrizes] = useState(() =>
    getSavedArray("luckykujiPrizes", DEFAULT_PRIZES),
  );

  const [nickname, setNickname] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [revealMode, setRevealMode] = useState("simultaneous");

  const [participantQueue, setParticipantQueue] = useState(() =>
    getSavedArray("luckykujiParticipantQueue", []),
  );
  const [draggedParticipantId, setDraggedParticipantId] = useState(null);
  const [dragOverParticipantId, setDragOverParticipantId] = useState(null);

  const [manualNumbers, setManualNumbers] = useState([]);
  const [lastConfirmedNumbers, setLastConfirmedNumbers] = useState([]);
  const [numberSearchValue, setNumberSearchValue] = useState("");
  const [numberSearchResult, setNumberSearchResult] = useState(null);
  const [highlightedNumber, setHighlightedNumber] = useState(null);
  const numberSearchHighlightTimerRef = useRef(null);

  const [pendingNumbers, setPendingNumbers] = useState([]);
  const [pendingPlayer, setPendingPlayer] = useState("");
  const [pendingMode, setPendingMode] = useState("");

  const [revealedIndexes, setRevealedIndexes] = useState([]);
  const [currentAppraisalIndex, setCurrentAppraisalIndex] = useState(-1);

  const [isPreparing, setIsPreparing] = useState(false);
  const [isAppraising, setIsAppraising] = useState(false);
  const [appraisalFinished, setAppraisalFinished] = useState(false);
  const [lockedResults, setLockedResults] = useState([]);
  const [revealStep, setRevealStep] = useState(0);
  const [analysisPhase, setAnalysisPhase] = useState("idle");
  const [displayStars, setDisplayStars] = useState(0);
  const [displayRarity, setDisplayRarity] = useState("?");
  const [highRarityAlert, setHighRarityAlert] = useState(false);
  const [activeRevealIndex, setActiveRevealIndex] = useState(0);
  const [draggingIndex, setDraggingIndex] = useState(-1);
  const [dragOffsets, setDragOffsets] = useState({});
  const [openedProductIndexes, setOpenedProductIndexes] = useState([]);
  const [draggingProductIndex, setDraggingProductIndex] = useState(-1);
  const [productDragOffsets, setProductDragOffsets] = useState({});
  const productDragOffsetRef = useRef({});
  const dragStartRef = useRef({ x: 0, y: 0 });
  const simultaneousScrollRef = useRef(null);

  const [notice, setNotice] = useState("참가자 정보를 입력해 주세요.");
  const [lastPlayer, setLastPlayer] = useState("");

  const [showSettings, setShowSettings] = useState(false);
  const [showHeaderKujiMenu, setShowHeaderKujiMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedRecordNickname, setSelectedRecordNickname] = useState("");
  const [isPrizePanelOpen, setIsPrizePanelOpen] = useState(false);
  const [showRandomNumberPicker, setShowRandomNumberPicker] = useState(false);
  const [shuffleCount, setShuffleCount] = useState(5);
  const [randomPickCount, setRandomPickCount] = useState(1);
  const [randomSoundEnabled, setRandomSoundEnabled] = useState(true);
  const [shuffleProgress, setShuffleProgress] = useState(0);
  const [shufflePreviewNumbers, setShufflePreviewNumbers] = useState([]);
  const [pendingRandomNumbers, setPendingRandomNumbers] = useState([]);
  const [isNumberShuffling, setIsNumberShuffling] = useState(false);
  const [isShuffleSettled, setIsShuffleSettled] = useState(false);
  const [activeTab, setActiveTab] = useState("kuji");
  const [newPrizeName, setNewPrizeName] = useState("");
  const [newPrizeGrade, setNewPrizeGrade] = useState("");
  const [newPrizeRarity, setNewPrizeRarity] = useState("B");
  const [newPrizeQuantity, setNewPrizeQuantity] = useState(1);
  const [newPrizeImage, setNewPrizeImage] = useState("");
  const [newPrizeImageFile, setNewPrizeImageFile] = useState(null);
  const [bulkPrizeText, setBulkPrizeText] = useState("");
  const prizeImageMigrationRef = useRef(false);
  const [activeKujiId, setActiveKujiId] = useState(
    () => localStorage.getItem("luckykujiActiveKujiId") || "kuji-default",
  );
  const [recordViewKujiId, setRecordViewKujiId] = useState(
    () => localStorage.getItem("luckykujiActiveKujiId") || "kuji-default",
  );
  const [kujiList, setKujiList] = useState(() =>
    getSavedArray("luckykujiKujiList", []),
  );
  const [newKujiTitle, setNewKujiTitle] = useState("");
  const [newKujiPrice, setNewKujiPrice] = useState(28000);
  const [newKujiTotalNumbers, setNewKujiTotalNumbers] = useState(666);
  const [prizeMap, setPrizeMap] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("luckykujiPrizeMap"));
      return saved && typeof saved === "object" && !Array.isArray(saved)
        ? compactPrizeMapForStorage(saved)
        : {};
    } catch {
      return {};
    }
  });

  const [isCloudReady, setIsCloudReady] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("서버 연결 중...");
  const [backupStatus, setBackupStatus] = useState("백업 준비 중...");
  const cloudSaveTimerRef = useRef(null);
  const cloudRetryTimerRef = useRef(null);
  const latestKujiListRef = useRef([]);
  const cloudRevisionRef = useRef(0);
  const savedCloudRevisionRef = useRef(0);
  const cloudSaveRunningRef = useRef(false);
  const cloudSaveRequestedRef = useRef(false);

  // 로그인 직후 Supabase 데이터를 먼저 불러옵니다.
  // 서버가 비어 있으면 현재 브라우저의 기존 데이터를 최초 1회 업로드합니다.
  useEffect(() => {
    if (!user?.id) return undefined;

    let cancelled = false;

    const hydrateFromCloud = async () => {
      try {
        setCloudStatus("서버 데이터 불러오는 중...");
        const cloudProjects = await loadKujiProjects(user.id);

        if (cancelled) return;

        if (cloudProjects.length > 0) {
          const preferredId =
            localStorage.getItem("luckykujiActiveKujiId") || cloudProjects[0].id;
          const selected =
            cloudProjects.find((project) => project.id === preferredId) ||
            cloudProjects[0];

          setKujiList(cloudProjects);
          setActiveKujiId(selected.id);
          setRecordViewKujiId(selected.id);
          setRoundTitle(selected.title || "럭키쿠지");
          setAccount(selected.account || "케이뱅크 100-204-176636");
          setPrice(Math.max(0, Number(selected.price) || 0));
          setTotalNumbers(Math.max(1, Number(selected.totalNumbers) || 1));
          setUsedNumbers(Array.isArray(selected.usedNumbers) ? selected.usedNumbers : []);
          setHistory(Array.isArray(selected.history) ? selected.history : []);
          setPrizes(Array.isArray(selected.prizes) ? selected.prizes : []);
          setParticipantQueue(
            Array.isArray(selected.participantQueue)
              ? selected.participantQueue
              : [],
          );
          setPrizeMap(
            selected.prizeMap && typeof selected.prizeMap === "object"
              ? compactPrizeMapForStorage(selected.prizeMap)
              : {},
          );
          setCloudStatus("서버 데이터 연결됨");
        } else {
          const localSnapshot = {
            id: activeKujiId || "kuji-default",
            title: roundTitle,
            account,
            price,
            totalNumbers,
            usedNumbers,
            history: compactHistoryForStorage(history),
            prizes,
            participantQueue,
            prizeMap: compactPrizeMapForStorage(prizeMap),
            updatedAt: new Date().toLocaleString("ko-KR"),
          };

          const migrationProjects =
            Array.isArray(kujiList) && kujiList.length > 0
              ? kujiList.map(compactKujiForStorage)
              : [localSnapshot];

          await syncKujiProjects(user.id, migrationProjects);
          if (cancelled) return;
          setKujiList(migrationProjects);
          setCloudStatus("기존 데이터를 서버로 이전함");
        }

        setIsCloudReady(true);
      } catch (error) {
        console.error("Supabase 쿠지 불러오기 실패:", error);
        if (!cancelled) {
          setCloudStatus("서버 연결 실패");
          setNotice(`서버 데이터를 불러오지 못했습니다: ${error.message}`);
        }
      }
    };

    hydrateFromCloud();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!isCloudReady) return;

    try {
      localStorage.setItem("luckykujiRoundTitle", roundTitle);
      localStorage.setItem("luckykujiAccount", account);
      localStorage.setItem("luckykujiPrice", String(price));
      localStorage.setItem("luckykujiTotalNumbers", String(totalNumbers));
      localStorage.setItem(
        "luckykujiUsedNumbers",
        JSON.stringify(usedNumbers),
      );
      localStorage.setItem("luckykujiHistory", JSON.stringify(compactHistoryForStorage(history)));
      localStorage.setItem("luckykujiPrizes", JSON.stringify(prizes));
      localStorage.setItem(
        "luckykujiParticipantQueue",
        JSON.stringify(participantQueue),
      );
      localStorage.setItem("luckykujiActiveKujiId", activeKujiId);
      localStorage.setItem("luckykujiPrizeMap", JSON.stringify(compactPrizeMapForStorage(prizeMap)));

      const activeSnapshot = {
        id: activeKujiId,
        title: roundTitle,
        account,
        price,
        totalNumbers,
        usedNumbers,
        history: compactHistoryForStorage(history),
        prizes,
        participantQueue,
        prizeMap: compactPrizeMapForStorage(prizeMap),
        updatedAt: new Date().toLocaleString("ko-KR"),
      };

      setKujiList((current) => {
        const exists = current.some((kuji) => kuji.id === activeKujiId);
        const next = exists
          ? current.map((kuji) =>
              kuji.id === activeKujiId ? activeSnapshot : kuji,
            )
          : [...current, activeSnapshot];

        return saveKujiListSafely(next, activeKujiId);
      });
    } catch (error) {
      console.warn("로컬 저장 공간이 부족해 일부 상태를 저장하지 못했습니다.", error);
      setNotice("브라우저 저장 공간이 부족해 중복 데이터를 정리했습니다.");
    }
  }, [
    roundTitle,
    account,
    price,
    totalNumbers,
    usedNumbers,
    history,
    prizes,
    participantQueue,
    activeKujiId,
    prizeMap,
    isCloudReady,
  ]);

  // 변경 사항을 즉시 로컬에 반영하고, Supabase에는 짧은 간격으로 안전하게 직렬 저장합니다.
  // 저장 중 추가 변경이 생기면 현재 저장이 끝난 직후 최신 상태를 다시 저장합니다.
  useEffect(() => {
    latestKujiListRef.current = kujiList;

    if (!isCloudReady || !user?.id) return undefined;

    cloudRevisionRef.current += 1;
    cloudSaveRequestedRef.current = true;
    window.clearTimeout(cloudSaveTimerRef.current);
    window.clearTimeout(cloudRetryTimerRef.current);
    setCloudStatus("자동 저장 대기 중...");

    const saveLatestProjects = async () => {
      if (cloudSaveRunningRef.current || !cloudSaveRequestedRef.current) return;

      cloudSaveRunningRef.current = true;
      cloudSaveRequestedRef.current = false;
      const savingRevision = cloudRevisionRef.current;
      let saveFailed = false;
      setCloudStatus("자동 저장 중...");

      try {
        const projects = latestKujiListRef.current.map(compactKujiForStorage);
        await syncKujiProjects(user.id, projects);
        savedCloudRevisionRef.current = savingRevision;
        setCloudStatus(`자동 저장 완료 · ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
      } catch (error) {
        saveFailed = true;
        console.error("Supabase 자동 저장 실패:", error);
        cloudSaveRequestedRef.current = true;
        setCloudStatus("자동 저장 실패 · 3초 후 재시도");
        cloudRetryTimerRef.current = window.setTimeout(saveLatestProjects, 3000);
      } finally {
        cloudSaveRunningRef.current = false;

        if (
          !saveFailed &&
          (cloudSaveRequestedRef.current ||
            savedCloudRevisionRef.current < cloudRevisionRef.current)
        ) {
          cloudSaveRequestedRef.current = true;
          window.clearTimeout(cloudSaveTimerRef.current);
          cloudSaveTimerRef.current = window.setTimeout(saveLatestProjects, 120);
        }
      }
    };

    cloudSaveTimerRef.current = window.setTimeout(saveLatestProjects, 180);

    return () => window.clearTimeout(cloudSaveTimerRef.current);
  }, [kujiList, isCloudReady, user?.id]);

  // 탭을 숨기거나 인터넷이 다시 연결됐을 때 남은 변경 사항을 한 번 더 저장합니다.
  useEffect(() => {
    if (!isCloudReady || !user?.id) return undefined;

    const flushPendingSave = async () => {
      if (savedCloudRevisionRef.current >= cloudRevisionRef.current) return;
      if (cloudSaveRunningRef.current) {
        cloudSaveRequestedRef.current = true;
        return;
      }

      cloudSaveRunningRef.current = true;
      const savingRevision = cloudRevisionRef.current;

      try {
        await syncKujiProjects(
          user.id,
          latestKujiListRef.current.map(compactKujiForStorage),
        );
        savedCloudRevisionRef.current = savingRevision;
        cloudSaveRequestedRef.current = false;
        setCloudStatus("자동 저장 완료");
      } catch (error) {
        cloudSaveRequestedRef.current = true;
        console.error("보조 자동 저장 실패:", error);
      } finally {
        cloudSaveRunningRef.current = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") void flushPendingSave();
    };
    const handleOnline = () => void flushPendingSave();
    const safetyInterval = window.setInterval(() => void flushPendingSave(), 10000);

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      window.clearInterval(safetyInterval);
      window.clearTimeout(cloudRetryTimerRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
    };
  }, [isCloudReady, user?.id]);

  // 현재 쿠지 전체를 브라우저에 자동 백업합니다. 5분마다 최대 30개 보관합니다.
  useEffect(() => {
    if (!isCloudReady || kujiList.length === 0) return undefined;

    const createBackup = (reason = "자동") => {
      const backup = writeAutoBackup(
        latestKujiListRef.current.length > 0
          ? latestKujiListRef.current
          : kujiList,
        activeKujiId,
        reason,
      );

      if (backup) {
        setBackupStatus(`최근 백업 · ${backup.createdAtLabel}`);
      } else {
        setBackupStatus("백업 저장 공간 확인 필요");
      }
    };

    createBackup("접속");
    const interval = window.setInterval(
      () => createBackup("5분 자동"),
      AUTO_BACKUP_INTERVAL_MS,
    );

    const handlePageHide = () => {
      writeAutoBackup(
        latestKujiListRef.current.length > 0
          ? latestKujiListRef.current
          : kujiList,
        activeKujiId,
        "종료 전",
      );
    };

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [isCloudReady, activeKujiId]);

  const createManualBackup = () => {
    const backup = writeAutoBackup(
      latestKujiListRef.current.length > 0
        ? latestKujiListRef.current
        : kujiList,
      activeKujiId,
      "수동",
    );

    if (!backup) {
      setNotice("백업을 만들지 못했습니다. 브라우저 저장 공간을 확인해 주세요.");
      return;
    }

    setBackupStatus(`최근 백업 · ${backup.createdAtLabel}`);
    setNotice("현재 쿠지 전체를 백업했습니다.");
  };

  const downloadLatestBackup = () => {
    const latest = readAutoBackups()[0];

    if (!latest) {
      setNotice("다운로드할 백업이 없습니다.");
      return;
    }

    const blob = new Blob([JSON.stringify(latest, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `luckykuji-backup-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setNotice("최근 백업 JSON 파일을 다운로드했습니다.");
  };

  const restoreLatestBackup = () => {
    const latest = readAutoBackups()[0];

    if (!latest || !Array.isArray(latest.projects) || latest.projects.length === 0) {
      setNotice("복원할 백업이 없습니다.");
      return;
    }

    if (
      !window.confirm(
        `${latest.createdAtLabel} 백업으로 전체 쿠지를 복원할까요? 현재 내용은 덮어씌워집니다.`,
      )
    ) {
      return;
    }

    const restoredProjects = latest.projects.map(compactKujiForStorage);
    const restoredId =
      restoredProjects.find((project) => project.id === latest.activeKujiId)?.id ||
      restoredProjects[0].id;
    const restored =
      restoredProjects.find((project) => project.id === restoredId) ||
      restoredProjects[0];

    setKujiList(restoredProjects);
    setActiveKujiId(restored.id);
    setRecordViewKujiId(restored.id);
    setRoundTitle(restored.title || "럭키쿠지");
    setAccount(restored.account || "");
    setPrice(Math.max(0, Number(restored.price) || 0));
    setTotalNumbers(Math.max(1, Number(restored.totalNumbers) || 1));
    setUsedNumbers(Array.isArray(restored.usedNumbers) ? restored.usedNumbers : []);
    setHistory(Array.isArray(restored.history) ? restored.history : []);
    setPrizes(Array.isArray(restored.prizes) ? restored.prizes : []);
    setParticipantQueue(
      Array.isArray(restored.participantQueue) ? restored.participantQueue : [],
    );
    setPrizeMap(
      restored.prizeMap && typeof restored.prizeMap === "object"
        ? compactPrizeMapForStorage(restored.prizeMap)
        : {},
    );
    localStorage.setItem("luckykujiActiveKujiId", restored.id);
    setBackupStatus(`복원됨 · ${latest.createdAtLabel}`);
    setNotice("최근 자동 백업을 복원했습니다. Supabase에도 자동 저장됩니다.");
    setShowSettings(false);
  };

  // 기존 localStorage/base64 이미지를 Supabase Storage로 최초 1회 이전합니다.
  useEffect(() => {
    if (!isCloudReady || !user?.id || prizeImageMigrationRef.current) return;

    const dataUrlPrizes = prizes.filter((prize) =>
      String(prize.image || "").startsWith("data:image/"),
    );

    if (dataUrlPrizes.length === 0) {
      prizeImageMigrationRef.current = true;
      return;
    }

    prizeImageMigrationRef.current = true;
    let cancelled = false;

    const migrateImages = async () => {
      setNotice(`기존 상품 이미지 ${dataUrlPrizes.length}개를 서버로 이전하는 중...`);
      const migrated = new Map();

      for (const prize of dataUrlPrizes) {
        try {
          const publicUrl = await uploadPrizeDataUrl(
            user.id,
            activeKujiId,
            prize.id,
            prize.image,
          );
          migrated.set(String(prize.id), publicUrl);
        } catch (error) {
          console.error(`상품 이미지 이전 실패 (${prize.name}):`, error);
        }
      }

      if (cancelled || migrated.size === 0) return;

      setPrizes((current) =>
        current.map((prize) =>
          migrated.has(String(prize.id))
            ? { ...prize, image: migrated.get(String(prize.id)) }
            : prize,
        ),
      );
      setNotice(`기존 상품 이미지 ${migrated.size}개를 Supabase로 이전했습니다.`);
    };

    migrateImages();

    return () => {
      cancelled = true;
    };
  }, [isCloudReady, user?.id, activeKujiId, prizes]);

  useEffect(() => {
    if (usedNumbers.length > 0 || Object.keys(prizeMap).length === 0) return;

    const mapPrizeCounts = Object.values(prizeMap).reduce((counts, result) => {
      const key = String(result.prizeId);
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});

    const prizeSettingsChanged =
      Object.keys(prizeMap).length !== totalNumbers ||
      prizes.some(
        (prize) =>
          (mapPrizeCounts[String(prize.id)] || 0) !==
            Math.max(0, Number(prize.total) || 0) ||
          Object.values(prizeMap).some(
            (result) =>
              result.prizeId === prize.id &&
              (result.prizeName !== prize.name ||
                result.grade !== prize.grade),
          ),
      );

    if (prizeSettingsChanged) {
      setPrizeMap({});
      localStorage.removeItem("luckykujiPrizeMap");
      setNotice(
        "상품 설정이 변경되어 기존 자동 배치를 해제했습니다. 다시 자동 배치해 주세요.",
      );
    }
  }, [prizes, totalNumbers]);

  useEffect(() => {
    const handleStorage = (event) => {
      if (
        event.key === "luckykujiActiveKujiId" ||
        event.key === "luckykujiKujiOpenedAt"
      ) {
        window.location.reload();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const compactMap = compactPrizeMapForStorage(prizeMap);

    if (JSON.stringify(compactMap) !== JSON.stringify(prizeMap)) {
      setPrizeMap(compactMap);

      try {
        localStorage.setItem(
          "luckykujiPrizeMap",
          JSON.stringify(compactMap),
        );
      } catch (error) {
        console.warn("상품 배치 데이터 정리 중 저장 공간이 부족합니다.", error);
      }
    }

    setKujiList((current) => saveKujiListSafely(current, activeKujiId));
  }, []);

  const allNumbers = useMemo(
    () => Array.from({ length: totalNumbers }, (_, index) => index + 1),
    [totalNumbers],
  );

  const availableNumbers = useMemo(
    () => allNumbers.filter((number) => !usedNumbers.includes(number)),
    [allNumbers, usedNumbers],
  );

  const currentPrizeTotal = prizes.reduce(
    (sum, prize) => sum + Math.max(0, Number(prize.total) || 0),
    0,
  );
  const currentPrizeRemainingTotal = prizes.reduce(
    (sum, prize) => sum + Math.max(0, Number(prize.remaining) || 0),
    0,
  );
  const hasInvalidPrizeQuantity = prizes.some((prize) => {
    const total = Number(prize.total);
    const remaining = Number(prize.remaining);

    return (
      !Number.isInteger(total) ||
      !Number.isInteger(remaining) ||
      total < 0 ||
      remaining < 0 ||
      total !== remaining
    );
  });
  const isAutoAssignmentQuantityMatched =
    totalNumbers > 0 &&
    currentPrizeTotal === totalNumbers &&
    currentPrizeRemainingTotal === totalNumbers &&
    !hasInvalidPrizeQuantity;

  const requestedNewKujiTotal = Math.max(
    1,
    Number(newKujiTotalNumbers) || 1,
  );
  const newKujiQuantityDifference = requestedNewKujiTotal - currentPrizeTotal;
  const isNewKujiQuantityMatched = newKujiQuantityDifference === 0;

  const assignedNumberCount = Object.keys(prizeMap).length;

  const recordViewKuji =
    kujiList.find((kuji) => kuji.id === recordViewKujiId) ||
    kujiList.find((kuji) => kuji.id === activeKujiId) ||
    null;

  const recordViewHistory =
    recordViewKujiId === activeKujiId
      ? history
      : Array.isArray(recordViewKuji?.history)
        ? recordViewKuji.history
        : [];

  const recordViewTitle =
    recordViewKujiId === activeKujiId
      ? roundTitle
      : recordViewKuji?.title || "선택한 쿠지";

  const participantDrawStats = useMemo(() => {
    const stats = new Map();

    recordViewHistory.forEach((entry) => {
      const cleanNickname = String(entry.nickname || "이름 없음").trim() || "이름 없음";
      const resultCount = Array.isArray(entry.results) ? entry.results.length : 0;

      if (!stats.has(cleanNickname)) {
        stats.set(cleanNickname, {
          nickname: cleanNickname,
          drawCount: 0,
          participationCount: 0,
          latestAt: entry.createdAt || "-",
        });
      }

      const current = stats.get(cleanNickname);
      current.drawCount += resultCount;
      current.participationCount += 1;

      if (entry.createdAt) {
        current.latestAt = entry.createdAt;
      }
    });

    return Array.from(stats.values()).sort(
      (a, b) =>
        b.drawCount - a.drawCount ||
        b.participationCount - a.participationCount ||
        a.nickname.localeCompare(b.nickname, "ko"),
    );
  }, [recordViewHistory]);

  const totalParticipantDrawCount = participantDrawStats.reduce(
    (sum, participant) => sum + participant.drawCount,
    0,
  );

  const selectedParticipantRecord = useMemo(() => {
    const nickname = String(selectedRecordNickname || "").trim();

    if (!nickname) return null;

    const participations = recordViewHistory
      .filter(
        (entry) =>
          (String(entry.nickname || "").trim() || "이름 없음") === nickname,
      )
      .map((entry, index) => ({
        id: entry.id ?? `${nickname}-${index}`,
        createdAt: entry.createdAt || "-",
        mode: entry.mode || "-",
        results: Array.isArray(entry.results) ? entry.results : [],
      }));

    if (participations.length === 0) return null;

    const prizeCounts = Array.from(
      participations
        .flatMap((entry) => entry.results)
        .reduce((map, result) => {
          const name = String(result.prizeName || "상품명 없음");
          const key = `${name}__${result.grade || ""}`;
          const current = map.get(key) || {
            name,
            grade: result.grade || "",
            count: 0,
          };

          current.count += 1;
          map.set(key, current);
          return map;
        }, new Map())
        .values(),
    ).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));

    return {
      nickname,
      participationCount: participations.length,
      drawCount: participations.reduce(
        (sum, entry) => sum + entry.results.length,
        0,
      ),
      latestAt: participations[0]?.createdAt || "-",
      participations,
      prizeCounts,
    };
  }, [selectedRecordNickname, recordViewHistory]);
  const isPrizeMapComplete =
    assignedNumberCount === totalNumbers &&
    allNumbers.every((number) => Boolean(prizeMap[String(number)] || prizeMap[number]));
  const canAutoAssign =
    usedNumbers.length === 0 &&
    isAutoAssignmentQuantityMatched;

  const remainingCount = availableNumbers.length;

  // 포인트 교환권 기능 제거: 실제 등록된 상품만 사용합니다.
  const effectivePrizes = prizes;

  // 상품 노출 순서는 희귀도만 기준으로 정렬합니다.
  // 품절 여부는 정렬에 사용하지 않으므로, 품절 상품도 해당 등급 위치를 그대로 유지합니다.
  const sortedEffectivePrizes = useMemo(() => {
    const rarityPriority = { S: 4, A: 3, B: 2, C: 1 };

    return effectivePrizes
      .map((prize, originalIndex) => ({ prize, originalIndex }))
      .sort((left, right) => {
        const leftRarity = String(
          getPrizeRarity(left.prize).rarity || "C",
        ).toUpperCase();
        const rightRarity = String(
          getPrizeRarity(right.prize).rarity || "C",
        ).toUpperCase();

        const rarityDifference =
          (rarityPriority[rightRarity] || 0) -
          (rarityPriority[leftRarity] || 0);

        if (rarityDifference !== 0) return rarityDifference;

        // 같은 등급에서는 관리 화면에 등록된 기존 순서를 그대로 유지합니다.
        return left.originalIndex - right.originalIndex;
      })
      .map(({ prize }) => prize);
  }, [effectivePrizes]);

  const prizeWinnerMap = useMemo(() => {
    const map = new Map();

    history.forEach((entry) => {
      (entry.results || []).forEach((result) => {
        const current = map.get(result.prizeId) || [];
        current.push({
          number: result.number,
          nickname: entry.nickname,
          createdAt: entry.createdAt,
        });
        map.set(result.prizeId, current);
      });
    });

    return map;
  }, [history]);

  const progress =
    totalNumbers > 0
      ? Math.round(((totalNumbers - remainingCount) / totalNumbers) * 100)
      : 0;

  const randomCount = 0;

  useEffect(() => {
    if (revealMode !== "simultaneous" || revealStep < 2) return;

    const frame = window.requestAnimationFrame(() => {
      const container = simultaneousScrollRef.current;
      if (!container) return;

      container.scrollTop = 0;
      container.scrollTo?.({ top: 0, behavior: "auto" });

      window.setTimeout(() => {
        if (!simultaneousScrollRef.current) return;
        simultaneousScrollRef.current.scrollTop = 0;
      }, 60);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [revealMode, revealStep, lockedResults.length]);

  const currentParticipant = participantQueue[0] || null;

  const restoreLockedRandomDraw = (openModal = true) => {
    const lockedDraw = readRandomDrawLock(activeKujiId);
    if (!lockedDraw) return false;

    const lockedNumbers = lockedDraw.numbers
      .map(Number)
      .filter((number) => Number.isInteger(number) && number >= 1 && number <= totalNumbers)
      .sort((a, b) => a - b);

    if (lockedNumbers.length < 1) {
      clearRandomDrawLock(activeKujiId);
      return false;
    }

    // 이미 상품 추첨까지 확정된 번호라면 오래된 잠금을 자동 정리합니다.
    if (lockedNumbers.every((number) => usedNumbers.includes(number))) {
      clearRandomDrawLock(activeKujiId);
      return false;
    }

    setShuffleCount(Number(lockedDraw.shuffleCount) || 5);
    setRandomPickCount(lockedNumbers.length);
    setShuffleProgress(Number(lockedDraw.shuffleCount) || 5);
    setShufflePreviewNumbers(lockedNumbers);
    setPendingRandomNumbers(lockedNumbers);
    setIsNumberShuffling(false);
    setIsPreparing(false);
    setIsShuffleSettled(true);
    if (openModal) setShowRandomNumberPicker(true);
    setNotice(
      `${lockedDraw.nickname || "참가자"}님의 미완료 추첨 번호를 복구했습니다. 같은 번호로 계속 진행해 주세요.`,
    );
    return true;
  };

  useEffect(() => {
    restoreLockedRandomDraw(false);
    // activeKujiId가 바뀌거나 서버 데이터가 복구된 뒤 미완료 추첨을 다시 확인합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKujiId, totalNumbers]);

  const addParticipantToQueue = () => {
    const cleanNickname = nickname.trim();
    const cleanQuantity = Number(quantity);

    if (!cleanNickname) {
      setNotice("대기열에 추가할 닉네임을 입력해 주세요.");
      return;
    }

    if (!Number.isInteger(cleanQuantity) || cleanQuantity < 1) {
      setNotice("구매 수량은 1개 이상이어야 합니다.");
      return;
    }

    if (cleanQuantity > remainingCount) {
      setNotice("구매 수량이 남은 번호보다 많습니다.");
      return;
    }

    setParticipantQueue((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random()}`,
        nickname: cleanNickname,
        quantity: cleanQuantity,
      },
    ]);

    setNickname("");
    setQuantity(1);
    setNotice(`${cleanNickname}님을 대기열 마지막에 추가했습니다.`);
  };


  const canReorderQueue =
    !isPreparing && !isAppraising && pendingNumbers.length === 0;

  const handleHorizontalQueueDragStart = (event, participantId) => {
    if (!canReorderQueue) {
      event.preventDefault();
      setNotice("추첨 또는 감정 진행 중에는 대기열 순서를 변경할 수 없습니다.");
      return;
    }

    setDraggedParticipantId(participantId);
    setDragOverParticipantId(participantId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", participantId);
  };

  const handleHorizontalQueueDragOver = (event, targetParticipantId) => {
    if (!canReorderQueue || !draggedParticipantId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (
      targetParticipantId === draggedParticipantId ||
      targetParticipantId === dragOverParticipantId
    ) {
      return;
    }

    setDragOverParticipantId(targetParticipantId);

    setParticipantQueue((current) => {
      const fromIndex = current.findIndex(
        (participant) => participant.id === draggedParticipantId,
      );
      const toIndex = current.findIndex(
        (participant) => participant.id === targetParticipantId,
      );

      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return current;
      }

      const nextQueue = [...current];
      const [movedParticipant] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, movedParticipant);
      return nextQueue;
    });
  };

  const finishHorizontalQueueDrag = () => {
    if (!draggedParticipantId) return;

    const movedParticipant = participantQueue.find(
      (participant) => participant.id === draggedParticipantId,
    );

    setDraggedParticipantId(null);
    setDragOverParticipantId(null);
    setManualNumbers([]);
    setLastConfirmedNumbers([]);

    if (movedParticipant) {
      setNotice(`${movedParticipant.nickname}님의 대기 순서를 변경했습니다.`);
    }
  };

  const removeParticipantFromQueue = (participantId) => {
    if (isPreparing || isAppraising || pendingNumbers.length > 0) {
      setNotice("감정 진행 중에는 대기열을 삭제할 수 없습니다.");
      return;
    }

    setParticipantQueue((current) => {
      const removedIndex = current.findIndex(
        (participant) => participant.id === participantId,
      );
      const removedParticipant = current[removedIndex];
      const nextQueue = current.filter(
        (participant) => participant.id !== participantId,
      );

      if (removedIndex === 0) {
        setManualNumbers([]);
        setNotice(
          removedParticipant
            ? `${removedParticipant.nickname}님을 삭제하고 다음 순번으로 이동했습니다.`
            : "다음 순번으로 이동했습니다.",
        );
      } else if (removedParticipant) {
        setNotice(`${removedParticipant.nickname}님을 대기열에서 삭제했습니다.`);
      }

      return nextQueue;
    });
  };

  const validateParticipant = () => {
    if (!currentParticipant) {
      setNotice("먼저 참가자를 대기열에 추가해 주세요.");
      return null;
    }

    const cleanNickname = currentParticipant.nickname;
    const cleanQuantity = Number(currentParticipant.quantity);

    if (cleanQuantity > remainingCount) {
      setNotice(
        `${cleanNickname}님의 구매 수량이 현재 남은 번호보다 많습니다.`,
      );
      return null;
    }

    return {
      cleanNickname,
      cleanQuantity,
    };
  };

  const playDrawStartSound = () => {
    if (!randomSoundEnabled) return;

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();

      const sweep = audioContext.createOscillator();
      const sweepGain = audioContext.createGain();
      const filter = audioContext.createBiquadFilter();

      sweep.type = "sine";
      sweep.frequency.setValueAtTime(170, audioContext.currentTime);
      sweep.frequency.exponentialRampToValueAtTime(
        1280,
        audioContext.currentTime + 0.72,
      );

      filter.type = "bandpass";
      filter.frequency.setValueAtTime(420, audioContext.currentTime);
      filter.frequency.exponentialRampToValueAtTime(
        1700,
        audioContext.currentTime + 0.72,
      );
      filter.Q.setValueAtTime(4.5, audioContext.currentTime);

      sweepGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      sweepGain.gain.exponentialRampToValueAtTime(
        0.075,
        audioContext.currentTime + 0.08,
      );
      sweepGain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.78,
      );

      sweep.connect(filter);
      filter.connect(sweepGain);
      sweepGain.connect(audioContext.destination);
      sweep.start();
      sweep.stop(audioContext.currentTime + 0.8);

      [0.16, 0.34, 0.52].forEach((offset, index) => {
        const blip = audioContext.createOscillator();
        const blipGain = audioContext.createGain();
        const startTime = audioContext.currentTime + offset;

        blip.type = "triangle";
        blip.frequency.setValueAtTime(620 + index * 145, startTime);
        blipGain.gain.setValueAtTime(0.0001, startTime);
        blipGain.gain.exponentialRampToValueAtTime(0.045, startTime + 0.008);
        blipGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.08);

        blip.connect(blipGain);
        blipGain.connect(audioContext.destination);
        blip.start(startTime);
        blip.stop(startTime + 0.09);
      });

      window.setTimeout(() => audioContext.close(), 1050);
    } catch (error) {
      console.warn("AI 스캔음을 재생하지 못했습니다.", error);
    }
  };

  const playDrawStepSound = (step = 1) => {
    if (!randomSoundEnabled) return;

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const baseFrequency = 520 + Math.min(step, 8) * 70;

      [0, 0.055].forEach((offset, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startTime = audioContext.currentTime + offset;

        oscillator.type = index === 0 ? "square" : "sine";
        oscillator.frequency.setValueAtTime(
          baseFrequency + index * 180,
          startTime,
        );
        oscillator.frequency.exponentialRampToValueAtTime(
          baseFrequency * 0.82,
          startTime + 0.09,
        );

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(
          index === 0 ? 0.025 : 0.035,
          startTime + 0.005,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          startTime + 0.105,
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + 0.11);
      });

      window.setTimeout(() => audioContext.close(), 260);
    } catch (error) {
      console.warn("AI 단계음을 재생하지 못했습니다.", error);
    }
  };

  const playDrawRevealSound = (isHighGrade = false) => {
    if (!randomSoundEnabled) return;

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();

      const notes = isHighGrade
        ? [261.63, 392, 523.25, 659.25, 783.99, 1046.5]
        : [329.63, 493.88, 659.25];

      notes.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startTime =
          audioContext.currentTime + index * (isHighGrade ? 0.075 : 0.1);

        oscillator.type = index % 2 === 0 ? "sine" : "triangle";
        oscillator.frequency.setValueAtTime(frequency, startTime);
        oscillator.detune.setValueAtTime(index % 2 === 0 ? -4 : 4, startTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(
          isHighGrade ? 0.095 : 0.065,
          startTime + 0.012,
        );
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          startTime + (isHighGrade ? 0.48 : 0.3),
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + (isHighGrade ? 0.5 : 0.32));
      });

      if (isHighGrade) {
        const shimmer = audioContext.createOscillator();
        const shimmerGain = audioContext.createGain();
        const shimmerStart = audioContext.currentTime + 0.22;

        shimmer.type = "sine";
        shimmer.frequency.setValueAtTime(1200, shimmerStart);
        shimmer.frequency.exponentialRampToValueAtTime(
          2600,
          shimmerStart + 0.62,
        );

        shimmerGain.gain.setValueAtTime(0.0001, shimmerStart);
        shimmerGain.gain.exponentialRampToValueAtTime(
          0.045,
          shimmerStart + 0.04,
        );
        shimmerGain.gain.exponentialRampToValueAtTime(
          0.0001,
          shimmerStart + 0.68,
        );

        shimmer.connect(shimmerGain);
        shimmerGain.connect(audioContext.destination);
        shimmer.start(shimmerStart);
        shimmer.stop(shimmerStart + 0.7);
      }

      window.setTimeout(
        () => audioContext.close(),
        isHighGrade ? 1400 : 800,
      );
    } catch (error) {
      console.warn("상품 공개음을 재생하지 못했습니다.", error);
    }
  };

  const openAppraisal = (numbers, player, mode) => {
    if (!isPrizeMapComplete) {
      const message =
        "상품 자동 배치가 완료되지 않았습니다. 관리 → 상품 관리에서 자동 배치를 먼저 실행해 주세요.";
      setNotice(message);
      window.alert(message);
      return;
    }

    const results = getAssignedResults(numbers, prizeMap, prizes);

    if (results.length !== numbers.length) {
      const message =
        "선택한 번호 중 상품이 배치되지 않은 번호가 있습니다. 자동 배치를 다시 확인해 주세요.";
      setNotice(message);
      window.alert(message);
      return;
    }

    const confirmedNumbers = [...numbers].sort((a, b) => a - b);

    // 감정 버튼을 누른 순간 번호와 상품 결과를 즉시 확정합니다.
    // 이후 감정 화면은 결과를 보여 주는 연출만 담당하므로,
    // 도중에 새로고침하거나 창을 닫아도 같은 번호를 다시 감정할 수 없습니다.
    setUsedNumbers((current) =>
      [...new Set([...current, ...confirmedNumbers])].sort((a, b) => a - b),
    );

    setHistory((current) => [
      {
        id: Date.now(),
        nickname: player,
        numbers: confirmedNumbers,
        quantity: confirmedNumbers.length,
        mode,
        results: results.map(removeResultImage),
        createdAt: new Date().toLocaleString("ko-KR"),
      },
      ...current,
    ]);

    setPrizes((current) =>
      current.map((prize) => {
        const usedCount = results.filter(
          (result) => result.prizeId === prize.id,
        ).length;

        return usedCount > 0
          ? { ...prize, remaining: Math.max(0, prize.remaining - usedCount) }
          : prize;
      }),
    );

    setLastPlayer(player);
    setLastConfirmedNumbers(confirmedNumbers);
    clearRandomDrawLock(activeKujiId);
    setManualNumbers([]);

    playDrawStartSound();

    // 번호가 여러 개면 항상 동시 추첨 방식으로 공개합니다.
    setRevealMode(numbers.length > 1 ? "simultaneous" : revealMode);
    setPendingNumbers(numbers);
    setPendingPlayer(player);
    setPendingMode(mode);
    setLockedResults(results);
    setActiveRevealIndex(0);
    setRevealStep(0);
    setHighRarityAlert(false);
    setAnalysisPhase("idle");
    setDisplayStars(0);
    setDisplayRarity("?");
    setRevealedIndexes([]);
    setCurrentAppraisalIndex(-1);
    setAppraisalFinished(false);
    setDraggingIndex(-1);
    setDragOffsets({});
    setOpenedProductIndexes([]);
    setDraggingProductIndex(-1);
    setProductDragOffsets({});
    productDragOffsetRef.current = {};
    setNotice(
      `${player}님의 번호 ${confirmedNumbers.join(", ")}번이 즉시 확정되었습니다. AI 분석을 시작해 주세요.`,
    );
  };

  const advanceReveal = async () => {
    if (isAppraising || appraisalFinished) return;

    const result = lockedResults[activeRevealIndex];
    if (!result) return;

    if (revealStep === 0) {
      playDrawStartSound();
      setIsAppraising(true);
      setNotice(
        revealMode === "simultaneous"
          ? `${pendingPlayer}님의 ${lockedResults.length}개 상품을 동시에 분석 중입니다...`
          : `${pendingPlayer}님의 ${activeRevealIndex + 1}번째 번호를 분석 중입니다...`,
      );
      setRevealStep(1);

      // 동시추첨은 첫 번째 상품이 아니라 전체 결과 중 가장 높은 등급을 분석합니다.
      const rarityPriority = { S: 4, A: 3, B: 2, C: 1 };
      const analysisTarget =
        revealMode === "simultaneous"
          ? lockedResults.reduce((highest, item) => {
              if (!highest) return item;

              const highestRarity = String(highest?.rarity || "C").toUpperCase();
              const itemRarity = String(item?.rarity || "C").toUpperCase();
              const highestRank = rarityPriority[highestRarity] || 0;
              const itemRank = rarityPriority[itemRarity] || 0;

              if (itemRank !== highestRank) {
                return itemRank > highestRank ? item : highest;
              }

              return Number(item?.stars || 0) > Number(highest?.stars || 0)
                ? item
                : highest;
            }, null) || result
          : result;

      // 1단계: 최고 등급 상품의 가치(별)를 먼저 보여줍니다.
      setAnalysisPhase("value");
      const finalStars = Math.max(
        0,
        Math.min(5, Number(analysisTarget?.stars) || 0),
      );

      // 0성부터 5성까지 한 칸씩 천천히 상승합니다.
      const risingStarSequence = [0, 1, 2, 3, 4, 5];
      const risingStarDelays = [260, 320, 380, 440, 500, 650];

      for (let index = 0; index < risingStarSequence.length; index += 1) {
        setDisplayStars(risingStarSequence[index]);
        playDrawStepSound(index + 1);
        await wait(risingStarDelays[index]);
      }

      setNotice("가치 데이터 최종 검증 중...");
      await wait(520);

      // 실제 가치가 5성보다 낮으면 5성에서 한 칸씩 내려와 최종 값에 멈춥니다.
      if (finalStars < 5) {
        for (let star = 4; star >= finalStars; star -= 1) {
          setDisplayStars(star);
          playDrawStepSound(7 + (4 - star));
          await wait(star === finalStars ? 520 : 300);
        }
      } else {
        await wait(420);
      }

      await wait(380);

      // 2단계: 가치 확정 후 최고 희귀도를 슬롯처럼 분석합니다.
      setAnalysisPhase("rarity");
      const finalRarity = String(analysisTarget?.rarity || "B").toUpperCase();
      const raritySequence = ["?", "C", "B", "A", "S", "A", "C", "S", "B", finalRarity];
      const rarityDelays = [90, 100, 115, 130, 155, 185, 220, 265, 330, 470];

      for (let index = 0; index < raritySequence.length; index += 1) {
        setDisplayRarity(raritySequence[index]);
        playDrawStepSound(index + 2);
        await wait(rarityDelays[index]);
      }

      // 동시추첨에 S등급이 포함되면 최종 상품 공개 전이 아니라 AI 분석 화면에서 즉시 연출합니다.
      if (revealMode === "simultaneous" && finalRarity === "S") {
        setHighRarityAlert(true);
        setNotice("⚠ HIGH RARITY DETECTED · S등급 상품이 감지되었습니다.");
        playDrawRevealSound(true);
        await wait(1700);
        setHighRarityAlert(false);
        await wait(220);
      } else {
        playDrawRevealSound(finalStars >= 4 || finalRarity === "S");
        await wait(650);
      }

      setAnalysisPhase("complete");

      setRevealStep(2);
      setIsAppraising(false);
      setNotice(
        revealMode === "simultaneous"
          ? finalRarity === "S"
            ? "AI 분석 완료 · S등급 포함이 확인되었습니다. 공개 버튼을 눌러 주세요."
            : "AI 분석 완료 · 결과는 아직 비공개입니다. 공개 버튼을 눌러 주세요."
          : "AI 분석 완료 · 희귀도, 가치, 상품은 아직 비공개입니다.",
      );
      return;
    }

    if (revealStep === 2) {
      const resultsToReveal =
        revealMode === "simultaneous" ? lockedResults : [result];
      const hasSGrade = resultsToReveal.some(
        (item) => String(item?.rarity || "").toUpperCase() === "S",
      );
      const hasHighGrade =
        hasSGrade ||
        resultsToReveal.some(
          (item) =>
            item?.isHit ||
            item?.rarity === "SSR" ||
            item?.rarity === "UR" ||
            item?.rarity === "SAR",
        );

      // S등급 전용 연출은 AI 분석 단계에서 이미 보여줍니다.
      // 최종 상품 공개 단계에서는 결과 공개음만 재생합니다.
      playDrawRevealSound(hasHighGrade);

      setRevealStep(4);

      if (revealMode === "simultaneous") {
        setRevealedIndexes(lockedResults.map((_, index) => index));
        setAppraisalFinished(true);
        setNotice(`${pendingPlayer}님의 모든 상품이 동시에 공개되었습니다.`);
      } else {
        setNotice(`${result.prizeName} 상품이 공개되었습니다.`);
      }
      return;
    }

    if (revealStep === 4) {
      const nextRevealed = [...revealedIndexes, activeRevealIndex];
      setRevealedIndexes(nextRevealed);

      if (activeRevealIndex + 1 >= lockedResults.length) {
        setAppraisalFinished(true);
        setNotice(`${pendingPlayer}님의 모든 상품이 공개되었습니다. 결과를 확정해 주세요.`);
        return;
      }

      playDrawStepSound(1);
      setActiveRevealIndex((current) => current + 1);
      setRevealStep(0);
      setNotice("다음 번호의 AI 분석을 시작해 주세요.");
    }
  };

  const playShuffleTick = (step, total) => {
    if (!randomSoundEnabled) return;

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const progress = total > 0 ? step / total : 0;

      const click = audioContext.createOscillator();
      const clickGain = audioContext.createGain();
      const wheel = audioContext.createOscillator();
      const wheelGain = audioContext.createGain();

      click.type = "square";
      click.frequency.setValueAtTime(
        320 + progress * 760,
        audioContext.currentTime,
      );
      clickGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      clickGain.gain.exponentialRampToValueAtTime(
        0.045,
        audioContext.currentTime + 0.004,
      );
      clickGain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.055,
      );

      wheel.type = "triangle";
      wheel.frequency.setValueAtTime(
        95 + progress * 80,
        audioContext.currentTime,
      );
      wheel.frequency.exponentialRampToValueAtTime(
        70 + progress * 45,
        audioContext.currentTime + 0.11,
      );
      wheelGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      wheelGain.gain.exponentialRampToValueAtTime(
        0.028,
        audioContext.currentTime + 0.012,
      );
      wheelGain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.12,
      );

      click.connect(clickGain);
      clickGain.connect(audioContext.destination);
      wheel.connect(wheelGain);
      wheelGain.connect(audioContext.destination);

      click.start();
      wheel.start();
      click.stop(audioContext.currentTime + 0.06);
      wheel.stop(audioContext.currentTime + 0.13);

      window.setTimeout(() => audioContext.close(), 220);
    } catch (error) {
      console.warn("룰렛 회전음을 재생하지 못했습니다.", error);
    }
  };

  const playRandomCompleteSound = () => {
    if (!randomSoundEnabled) return;

    try {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const notes = [523.25, 659.25, 783.99];

      notes.forEach((frequency, index) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startTime = audioContext.currentTime + index * 0.11;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, startTime);
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.09, startTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.22);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startTime);
        oscillator.stop(startTime + 0.23);
      });

      window.setTimeout(() => audioContext.close(), 650);
    } catch (error) {
      console.warn("완료 소리를 재생하지 못했습니다.", error);
    }
  };

  const openRandomNumberPicker = () => {
    if (pendingNumbers.length > 0 || isAppraising || isPreparing) return;

    // 이전 추첨이 확정되기 전에 닫혔거나 새로고침된 경우 새 번호를 뽑지 않고 그대로 복구합니다.
    if (restoreLockedRandomDraw(true)) return;

    if (!currentParticipant) {
      setNotice("번호 랜덤 추첨 전에 참가자를 대기열에 추가해 주세요.");
      return;
    }

    setShuffleCount(5);
    setRandomPickCount(
      Math.max(
        1,
        Math.min(
          availableNumbers.length,
          Number(currentParticipant.quantity) || 1,
        ),
      ),
    );
    setShuffleProgress(0);
    setShufflePreviewNumbers([]);
    setShowRandomNumberPicker(true);
  };

  const runRandomNumberPicker = async () => {
    if (isNumberShuffling || !currentParticipant) return;

    const pickQuantity = Math.max(
      1,
      Math.min(
        availableNumbers.length,
        Number(randomPickCount) || 1,
      ),
    );
    const requestedShuffleCount = Math.max(
      1,
      Math.min(30, Number(shuffleCount) || 1),
    );

    if (availableNumbers.length < pickQuantity) {
      setNotice("남은 번호가 참가자의 선택 수량보다 부족합니다.");
      return;
    }

    setIsNumberShuffling(true);
    setIsShuffleSettled(false);
    setIsPreparing(true);
    setShuffleProgress(0);
    setPendingRandomNumbers([]);
    setManualNumbers([]);
    setLastConfirmedNumbers([]);
    setNotice(
      `${currentParticipant.nickname}님의 번호를 ${requestedShuffleCount}번 섞고 있습니다.`,
    );

    // 최종 번호를 애니메이션 시작 전에 한 번만 결정하고 즉시 브라우저에 잠급니다.
    // 이후 새로고침하거나 창을 닫아도 이 번호가 복구되므로 재추첨할 수 없습니다.
    const finalNumbers = shuffleArray(availableNumbers)
      .slice(0, pickQuantity)
      .sort((a, b) => a - b);

    writeRandomDrawLock(activeKujiId, {
      kujiId: activeKujiId,
      participantId: currentParticipant.id,
      nickname: currentParticipant.nickname,
      quantity: pickQuantity,
      shuffleCount: requestedShuffleCount,
      numbers: finalNumbers,
      createdAt: new Date().toISOString(),
    });

    for (let step = 1; step <= requestedShuffleCount; step += 1) {
      const progressRatio = step / requestedShuffleCount;
      const previewNumbers =
        step === requestedShuffleCount
          ? finalNumbers
          : shuffleArray(availableNumbers).slice(0, pickQuantity);

      // 화면에서는 매 단계 숫자가 바뀌지만 마지막 결과는 시작 시 잠근 번호와 같습니다.
      setShufflePreviewNumbers([...previewNumbers]);
      setShuffleProgress(step);
      playShuffleTick(step, requestedShuffleCount);

      const delay =
        progressRatio < 0.5
          ? 115
          : progressRatio < 0.78
            ? 165
            : progressRatio < 0.92
              ? 235
              : 340;

      await wait(delay);
    }

    setShufflePreviewNumbers(finalNumbers);
    setPendingRandomNumbers(finalNumbers);
    setIsShuffleSettled(true);
    playRandomCompleteSound();

    setIsNumberShuffling(false);
    setIsPreparing(false);
    setNotice(
      `${requestedShuffleCount}번 섞기 완료 · 아직 번호는 확정되지 않았습니다. 결과를 확인한 뒤 확인 버튼을 눌러 주세요.`,
    );
  };


  const prepareRandomAppraisal = async () => {
    if (pendingNumbers.length > 0 || isAppraising || isPreparing) return;

    const participant = validateParticipant();

    if (!participant) return;

    const { cleanNickname, cleanQuantity } = participant;

    setIsPreparing(true);
    setManualNumbers([]);
    setLastConfirmedNumbers([]);
    setNotice(`${cleanNickname}님의 번호를 섞고 있습니다...`);

    await wait(1100);

    const pickedNumbers = shuffleArray(availableNumbers).slice(
      0,
      cleanQuantity,
    );

    openAppraisal(pickedNumbers, cleanNickname, "랜덤 선택");
    setIsPreparing(false);
  };

  const toggleManualNumber = (number) => {
    if (
      usedNumbers.includes(number) ||
      isPreparing ||
      isAppraising ||
      pendingNumbers.length > 0
    ) {
      return;
    }

    if (!currentParticipant) {
      setNotice("번호를 고르기 전에 참가자를 대기열에 추가해 주세요.");
      return;
    }

    setManualNumbers((current) => {
      if (current.includes(number)) {
        const next = current.filter((item) => item !== number);
        setNotice(
          `${number}번 선택 취소 · 현재 ${next.length}개 선택됨`,
        );
        return next;
      }

      const next = [...current, number].sort((a, b) => a - b);

      setNotice(
        `${number}번 선택 · 현재 ${next.length}개 동시추첨 선택됨`,
      );

      return next;
    });
  };

  const searchNumber = () => {
    const searchedNumber = Number(String(numberSearchValue).trim());

    window.clearTimeout(numberSearchHighlightTimerRef.current);

    if (!Number.isInteger(searchedNumber) || searchedNumber < 1 || searchedNumber > totalNumbers) {
      setHighlightedNumber(null);
      setNumberSearchResult({
        type: "error",
        message: `1번부터 ${totalNumbers}번 사이의 번호를 입력해 주세요.`,
      });
      return;
    }

    const target = document.querySelector(`[data-kuji-number="${searchedNumber}"]`);
    const isUsed = usedNumbers.includes(searchedNumber);

    setHighlightedNumber(searchedNumber);
    setNumberSearchResult({
      type: isUsed ? "used" : "available",
      message: `${searchedNumber}번 · ${isUsed ? "판매 완료" : "선택 가능"}`,
    });
    setNotice(`${searchedNumber}번 위치로 이동했습니다. ${isUsed ? "이미 판매된 번호입니다." : "선택 가능한 번호입니다."}`);

    target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    target?.focus({ preventScroll: true });

    numberSearchHighlightTimerRef.current = window.setTimeout(() => {
      setHighlightedNumber(null);
    }, 3000);
  };

  useEffect(() => () => {
    window.clearTimeout(numberSearchHighlightTimerRef.current);
  }, []);

  const prepareManualAppraisal = () => {
    if (pendingNumbers.length > 0 || isAppraising || isPreparing) return;

    if (!currentParticipant) {
      setNotice("먼저 참가자를 대기열에 추가해 주세요.");
      return;
    }

    if (manualNumbers.length < 1) {
      setNotice("추첨할 번호를 한 개 이상 선택해 주세요.");
      return;
    }

    if (manualNumbers.length > remainingCount) {
      setNotice("선택한 번호가 현재 남은 번호보다 많습니다.");
      return;
    }

    setRevealMode(
      manualNumbers.length > 1 ? "simultaneous" : "sequential",
    );

    openAppraisal(
      [...manualNumbers],
      currentParticipant.nickname,
      manualNumbers.length > 1
        ? `${manualNumbers.length}개 동시 선택`
        : "수동 선택",
    );
  };

  const handleCardPointerDown = (event, index) => {
    if (appraisalFinished || revealedIndexes.includes(index)) return;

    const nextIndex = pendingNumbers.findIndex(
      (_, cardIndex) => !revealedIndexes.includes(cardIndex),
    );

    if (index !== nextIndex) {
      setNotice("왼쪽 카드부터 순서대로 열어 주세요.");
      return;
    }

    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDraggingIndex(index);
    setCurrentAppraisalIndex(index);
    setNotice("카드를 천천히 밀어 번호를 확인해 보세요.");
  };

  const handleCardPointerMove = (event, index) => {
    if (draggingIndex !== index) return;

    const x = event.clientX - dragStartRef.current.x;
    const y = event.clientY - dragStartRef.current.y;
    const limitedX = Math.max(-320, Math.min(320, x));
    const limitedY = Math.max(-260, Math.min(260, y));

    setDragOffsets((current) => ({
      ...current,
      [index]: { x: limitedX, y: limitedY },
    }));
  };

  const finishCardDrag = (event, index) => {
    if (draggingIndex !== index) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const offset = dragOffsets[index] || { x: 0, y: 0 };
    const distance = Math.hypot(offset.x, offset.y);

    setDraggingIndex(-1);

    if (distance < 185) {
      setDragOffsets((current) => ({
        ...current,
        [index]: { x: 0, y: 0 },
      }));
      setCurrentAppraisalIndex(-1);
      setNotice("번호가 살짝 보입니다. 카드를 조금 더 밀어 완전히 공개해 주세요.");
      return;
    }

    const nextRevealed = [...revealedIndexes, index];
    setRevealedIndexes(nextRevealed);
    setDragOffsets((current) => ({
      ...current,
      [index]: { x: 0, y: 0 },
    }));
    setNotice(
      `${pendingPlayer}님 카드 공개 · ${nextRevealed.length}/${pendingNumbers.length}`,
    );

    window.setTimeout(() => {
      setCurrentAppraisalIndex(-1);
    }, 650);

    if (nextRevealed.length === pendingNumbers.length) {
      setAppraisalFinished(true);
      setNotice(
        `${pendingPlayer}님의 모든 번호가 공개되었습니다. 결과 확정을 눌러 주세요.`,
      );
    }
  };

  const handleProductPointerDown = (event, index) => {
    if (revealStep < 4 || openedProductIndexes.includes(index)) return;

    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDraggingProductIndex(index);
    setNotice("FINAL PRODUCT 덮개를 잡고 옆으로 밀어 상품을 공개해 주세요.");
  };

  const openProductCover = (index, direction = 1) => {
    const safeDirection = direction >= 0 ? 1 : -1;
    const openedOffset = {
      x: safeDirection * Math.max(window.innerWidth + 400, 1800),
      y: 0,
    };

    setOpenedProductIndexes((current) =>
      current.includes(index) ? current : [...current, index],
    );

    productDragOffsetRef.current[index] = openedOffset;
    setProductDragOffsets((current) => ({
      ...current,
      [index]: openedOffset,
    }));

    setDraggingProductIndex(-1);
    setNotice("FINAL PRODUCT가 공개되었습니다.");
  };

  const handleProductPointerMove = (event, index) => {
    if (draggingProductIndex !== index) return;

    const x = event.clientX - dragStartRef.current.x;
    const maxDragDistance = Math.max(window.innerWidth, 1400);
    const limitedX = Math.max(
      -maxDragDistance,
      Math.min(maxDragDistance, x),
    );

    const nextOffset = { x: limitedX, y: 0 };
    productDragOffsetRef.current[index] = nextOffset;

    setProductDragOffsets((current) => ({
      ...current,
      [index]: nextOffset,
    }));
  };

  const finishProductDrag = (event, index) => {
    if (openedProductIndexes.includes(index)) return;
    if (draggingProductIndex !== index) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);

    const offset =
      productDragOffsetRef.current[index] ||
      productDragOffsets[index] ||
      { x: 0, y: 0 };

    setDraggingProductIndex(-1);

    const coverWidth =
      event.currentTarget.parentElement?.getBoundingClientRect?.().width || 980;
    const openDistance = Math.max(240, coverWidth * 0.9);

    if (Math.abs(offset.x) < openDistance) {
      productDragOffsetRef.current[index] = { x: 0, y: 0 };

      setProductDragOffsets((current) => ({
        ...current,
        [index]: { x: 0, y: 0 },
      }));

      setNotice("FINAL PRODUCT 덮개를 끝까지 밀어 주세요.");
      return;
    }

    openProductCover(index, offset.x);
  };

  const openAllProducts = () => {
    if (revealStep < 4 || lockedResults.length === 0) return;

    const allIndexes = lockedResults.map((_, index) => index);
    const openDistance = Math.max(window.innerWidth + 400, 1800);
    const allOffsets = {};

    allIndexes.forEach((index) => {
      allOffsets[index] = {
        x: index % 2 === 0 ? -openDistance : openDistance,
        y: 0,
      };
    });

    productDragOffsetRef.current = allOffsets;
    setProductDragOffsets(allOffsets);
    setOpenedProductIndexes(allIndexes);
    setDraggingProductIndex(-1);
    setNotice(`FINAL PRODUCT ${lockedResults.length}개를 한 번에 공개했습니다.`);
  };

  const confirmAppraisal = () => {
    if (!appraisalFinished || pendingNumbers.length === 0) return;

    const confirmedPlayer = pendingPlayer;
    const confirmedNumbers = [...pendingNumbers].sort((a, b) => a - b);

    closeAppraisal();
    setNotice(
      `${confirmedPlayer}님의 번호 ${confirmedNumbers.join(", ")}번은 감정 시작 시 이미 확정되었습니다.`,
    );
  };

  const closeAppraisal = () => {
    if (isAppraising) return;

    setPendingNumbers([]);
    setPendingPlayer("");
    setPendingMode("");
    setRevealedIndexes([]);
    setCurrentAppraisalIndex(-1);
    setAppraisalFinished(false);
    setLockedResults([]);
    setRevealStep(0);
    setHighRarityAlert(false);
    setAnalysisPhase("idle");
    setDisplayStars(0);
    setDisplayRarity("?");
    setActiveRevealIndex(0);
    setDraggingIndex(-1);
    setDragOffsets({});
    setOpenedProductIndexes([]);
    setDraggingProductIndex(-1);
    setProductDragOffsets({});
    productDragOffsetRef.current = {};
  };

  const cancelAppraisal = () => {
    if (isAppraising) return;

    const confirmedPlayer = pendingPlayer;
    const confirmedNumbers = [...pendingNumbers].sort((a, b) => a - b);

    closeAppraisal();
    setNotice(
      confirmedNumbers.length > 0
        ? `${confirmedPlayer}님의 번호 ${confirmedNumbers.join(", ")}번은 이미 확정되어 감정창만 닫았습니다.`
        : "감정창을 닫았습니다.",
    );
  };

  const undoLastDraw = () => {
    if (pendingNumbers.length > 0 || isAppraising) {
      setNotice("현재 감정을 먼저 완료하거나 취소해 주세요.");
      return;
    }

    if (history.length === 0) {
      setNotice("되돌릴 기록이 없습니다.");
      return;
    }

    const [latest, ...restHistory] = history;

    setUsedNumbers((current) =>
      current.filter((number) => !latest.numbers.includes(number)),
    );

    setHistory(restHistory);
    setPrizes((current) =>
      current.map((prize) => {
        const restoredCount = (latest.results || []).filter(
          (result) => result.prizeId === prize.id,
        ).length;

        return restoredCount > 0
          ? {
              ...prize,
              remaining: Math.min(
                Number(prize.total) || 0,
                (Number(prize.remaining) || 0) + restoredCount,
              ),
            }
          : prize;
      }),
    );
    setLastConfirmedNumbers([]);
    setLastPlayer(restHistory[0]?.nickname || "");

    setNotice(`${latest.nickname}님의 마지막 진행을 취소했습니다.`);
  };

  const resetRound = () => {
    const confirmed = window.confirm(
      "번호, 기록, 상품 수량을 모두 초기화할까요?",
    );

    if (!confirmed) return;

    setUsedNumbers([]);
    setHistory([]);
    setManualNumbers([]);
    setLastConfirmedNumbers([]);

    setPendingNumbers([]);
    setPendingPlayer("");
    setPendingMode("");
    setRevealedIndexes([]);
    setCurrentAppraisalIndex(-1);

    setIsPreparing(false);
    setIsAppraising(false);
    setAppraisalFinished(false);

    setNickname("");
    setQuantity(1);
    setRevealMode("simultaneous");
    setParticipantQueue([]);
    setLastPlayer("");
    setPrizes((current) =>
      current.map((prize) => ({
        ...prize,
        remaining: Math.max(0, Number(prize.total) || 0),
      })),
    );
    setPrizeMap({});
    localStorage.removeItem("luckykujiPrizeMap");

    setNotice("새 회차가 시작되었습니다. 상품 자동 배치를 다시 진행해 주세요.");
  };

  const changePrizeRemaining = (prizeId, changeAmount) => {
    setPrizes((current) =>
      current.map((prize) => {
        if (prize.id !== prizeId) return prize;

        return {
          ...prize,
          remaining: Math.max(
            0,
            Math.min(prize.total, prize.remaining + changeAmount),
          ),
        };
      }),
    );
  };

  const autoAssignPrizes = () => {
    if (usedNumbers.length > 0) {
      const message =
        "이미 추첨 기록이 있는 쿠지입니다. 자동 배치를 새로 하려면 새 쿠지를 생성하거나 현재 회차를 초기화해 주세요.";
      setNotice(message);
      window.alert(message);
      return;
    }

    if (hasInvalidPrizeQuantity) {
      const invalidPrize = prizes.find((prize) => {
        const total = Number(prize.total);
        const remaining = Number(prize.remaining);

        return (
          !Number.isInteger(total) ||
          !Number.isInteger(remaining) ||
          total < 0 ||
          remaining < 0 ||
          total !== remaining
        );
      });

      const message = invalidPrize
        ? `${invalidPrize.name}의 전체 수량과 남은 수량이 다릅니다. 자동 배치 전에는 두 수량이 반드시 같아야 합니다.`
        : "상품 수량에는 0 이상의 정수만 입력할 수 있습니다.";

      setNotice(message);
      window.alert(message);
      return;
    }

    if (
      currentPrizeTotal !== totalNumbers ||
      currentPrizeRemainingTotal !== totalNumbers
    ) {
      const totalDifference = totalNumbers - currentPrizeTotal;
      const remainingDifference =
        totalNumbers - currentPrizeRemainingTotal;

      const message = [
        "상품 수량이 전체 번호와 일치하지 않아 자동 배치할 수 없습니다.",
        "",
        `전체 번호: ${totalNumbers}개`,
        `상품 전체 수량 합계: ${currentPrizeTotal}개`,
        `상품 남은 수량 합계: ${currentPrizeRemainingTotal}개`,
        "",
        totalDifference === 0
          ? "전체 수량 합계: 일치"
          : totalDifference > 0
            ? `전체 수량이 ${totalDifference}개 부족`
            : `전체 수량이 ${Math.abs(totalDifference)}개 초과`,
        remainingDifference === 0
          ? "남은 수량 합계: 일치"
          : remainingDifference > 0
            ? `남은 수량이 ${remainingDifference}개 부족`
            : `남은 수량이 ${Math.abs(remainingDifference)}개 초과`,
      ].join("\n");

      setNotice(message);
      window.alert(message);
      return;
    }

    const confirmed = window.confirm(
      [
        "상품을 번호에 자동 배치할까요?",
        "",
        `총 번호: ${totalNumbers}개`,
        `상품 전체 수량: ${currentPrizeTotal}개`,
        `상품 남은 수량: ${currentPrizeRemainingTotal}개`,
        "",
        "기존 배치 결과가 있다면 모두 새로 섞입니다.",
        "배치 후 추첨이 시작되면 다시 배치할 수 없습니다.",
      ].join("\n"),
    );

    if (!confirmed) return;

    const nextMap = createPrizeAssignment(totalNumbers, prizes);

    if (!nextMap) {
      const message =
        "수량 검증에 실패했습니다. 전체 번호, 상품 전체 수량, 남은 수량을 모두 동일하게 맞춰 주세요.";
      setNotice(message);
      window.alert(message);
      return;
    }

    setPrizeMap(nextMap);
    localStorage.setItem("luckykujiPrizeMap", JSON.stringify(nextMap));
    setNotice(
      `자동 배치 완료 · ${totalNumbers}개 번호에 상품을 모두 고정했습니다.`,
    );
  };

  const clearPrizeAssignment = () => {
    if (usedNumbers.length > 0) {
      setNotice("추첨이 시작된 쿠지의 배치는 삭제할 수 없습니다.");
      return;
    }

    if (!Object.keys(prizeMap).length) {
      setNotice("삭제할 자동 배치 결과가 없습니다.");
      return;
    }

    if (!window.confirm("현재 자동 배치 결과를 삭제할까요?")) return;

    setPrizeMap({});
    localStorage.removeItem("luckykujiPrizeMap");
    setNotice("자동 배치 결과를 삭제했습니다.");
  };

  const openNewKuji = async () => {
    const cleanTitle = newKujiTitle.trim();

    if (!cleanTitle) {
      setNotice("새 쿠지 이름을 입력해 주세요.");
      return;
    }

    const newId = `kuji-${Date.now()}`;
    const newKuji = {
      id: newId,
      title: cleanTitle,
      account,
      price: Math.max(0, Number(newKujiPrice) || 0),
      totalNumbers: requestedNewKujiTotal,
      usedNumbers: [],
      history: [],
      // 쿠지마다 독립적인 상품 목록을 사용합니다.
      // 새 쿠지는 빈 상품 목록으로 만들고 상품 관리에서 따로 구성합니다.
      prizes: [],
      participantQueue: [],
      prizeMap: {},
      updatedAt: new Date().toLocaleString("ko-KR"),
    };

    // React 상태 업데이트 순서 때문에 새 쿠지가 직전 쿠지로 되돌아가는 현상을 막기 위해
    // 목록을 먼저 확정하고, 같은 목록을 즉시 Supabase에도 저장합니다.
    const nextKujiList = [
      ...kujiList.filter((kuji) => kuji.id !== newId),
      newKuji,
    ];

    setKujiList(nextKujiList);
    setActiveKujiId(newId);
    setRecordViewKujiId(newId);
    setRoundTitle(newKuji.title);
    setPrice(newKuji.price);
    setTotalNumbers(newKuji.totalNumbers);
    setUsedNumbers([]);
    setHistory([]);
    setPrizes([]);
    setPrizeMap({});
    setParticipantQueue([]);
    setManualNumbers([]);
    setLastConfirmedNumbers([]);
    setNewKujiTitle("");

    localStorage.setItem("luckykujiActiveKujiId", newId);
    localStorage.removeItem("luckykujiPrizeMap");

    try {
      setCloudStatus("새 쿠지 서버 저장 중...");
      await syncKujiProjects(
        user.id,
        nextKujiList.map(compactKujiForStorage),
      );
      setCloudStatus("서버 저장 완료");
      setNotice(
        `${cleanTitle} 쿠지를 만들었습니다. 상품 관리에서 이 쿠지의 보상을 등록해 주세요.`,
      );
    } catch (error) {
      console.error("새 쿠지 서버 저장 실패:", error);
      setCloudStatus("서버 저장 실패");
      setNotice(`쿠지는 화면에 생성됐지만 서버 저장에 실패했습니다: ${error.message}`);
    }
  };

  const activateKuji = (kuji) => {
    if (!kuji || kuji.id === activeKujiId) return;

    setActiveKujiId(kuji.id);
    setRecordViewKujiId(kuji.id);
    setRoundTitle(kuji.title || "럭키쿠지");
    setAccount(kuji.account || account);
    setPrice(Math.max(0, Number(kuji.price) || 0));
    setTotalNumbers(Math.max(1, Number(kuji.totalNumbers) || 1));
    setUsedNumbers(Array.isArray(kuji.usedNumbers) ? kuji.usedNumbers : []);
    setHistory(Array.isArray(kuji.history) ? kuji.history : []);
    setPrizes(Array.isArray(kuji.prizes) ? kuji.prizes : []);
    const restoredPrizeMap =
      kuji.prizeMap && typeof kuji.prizeMap === "object"
        ? compactPrizeMapForStorage(kuji.prizeMap)
        : {};
    setPrizeMap(restoredPrizeMap);
    localStorage.setItem(
      "luckykujiPrizeMap",
      JSON.stringify(restoredPrizeMap),
    );
    setParticipantQueue(
      Array.isArray(kuji.participantQueue) ? kuji.participantQueue : [],
    );
    setManualNumbers([]);
    setLastConfirmedNumbers([]);
    localStorage.setItem("luckykujiActiveKujiId", kuji.id);
    localStorage.setItem("luckykujiKujiOpenedAt", String(Date.now()));
    setNotice(`${kuji.title} 쿠지로 전환했습니다.`);
  };

  const deleteSavedKuji = (kujiId) => {
    if (kujiId === activeKujiId) {
      setNotice("현재 오픈 중인 쿠지는 삭제할 수 없습니다.");
      return;
    }

    if (!window.confirm("이 쿠지를 목록에서 삭제할까요?")) return;

    setKujiList((current) => {
      const next = current.filter((kuji) => kuji.id !== kujiId);
      return saveKujiListSafely(next, activeKujiId);
    });
  };

  const addManagedPrize = async () => {
    const cleanName = newPrizeName.trim();
    const cleanGrade = newPrizeGrade.trim() || "일반 상품";
    const cleanQuantity = Math.max(1, Number(newPrizeQuantity) || 1);

    if (!cleanName) {
      setNotice("상품명을 입력해 주세요.");
      return;
    }

    const prizeId = `prize-${Date.now()}-${Math.random()}`;
    let imageUrl = newPrizeImage;

    try {
      if (newPrizeImageFile) {
        setNotice("상품 이미지를 Supabase에 업로드하는 중...");
        imageUrl = await uploadPrizeImage(
          user?.id,
          activeKujiId,
          prizeId,
          newPrizeImageFile,
        );
      }

      setPrizes((current) => [
        ...current,
        {
          id: prizeId,
          name: cleanName,
          grade: cleanGrade,
          rarity: newPrizeRarity,
          total: cleanQuantity,
          remaining: cleanQuantity,
          image: imageUrl || "",
          featured: false,
        },
      ]);

      setNewPrizeName("");
      setNewPrizeGrade("");
      setNewPrizeRarity("B");
      setNewPrizeQuantity(1);
      setNewPrizeImage("");
      setNewPrizeImageFile(null);
      setNotice(`${cleanName} 상품을 추가하고 서버에 저장했습니다.`);
    } catch (error) {
      console.error("상품 이미지 업로드 실패:", error);
      setNotice(`상품 이미지 업로드 실패: ${error.message}`);
      window.alert(error.message);
    }
  };

  const addBulkManagedPrizes = () => {
    const rawLines = bulkPrizeText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (rawLines.length === 0) {
      setNotice("붙여넣을 상품 목록을 입력해 주세요.");
      return;
    }

    const parsedPrizes = [];
    const errors = [];

    rawLines.forEach((line, index) => {
      const columns = line
        .split(line.includes("\t") ? "\t" : ",")
        .map((value) => value.trim());

      const [name, rarityValue, quantityValue] = columns;
      const rarity = String(rarityValue || "").toUpperCase();
      const quantity = Number(quantityValue);

      if (!name) {
        errors.push(`${index + 1}줄: 상품명이 없습니다.`);
        return;
      }

      if (!["S", "A", "B", "C"].includes(rarity)) {
        errors.push(`${index + 1}줄: 희귀도는 S, A, B, C 중 하나여야 합니다.`);
        return;
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        errors.push(`${index + 1}줄: 수량은 1 이상의 정수여야 합니다.`);
        return;
      }

      parsedPrizes.push({
        id: `prize-${Date.now()}-${index}-${Math.random()}`,
        name,
        grade: "일반 상품",
        rarity,
        total: quantity,
        remaining: quantity,
        image: "",
        featured: false,
      });
    });

    if (errors.length > 0) {
      const preview = errors.slice(0, 5).join("\n");
      window.alert(
        `등록 형식을 확인해 주세요.\n\n${preview}${
          errors.length > 5 ? `\n외 ${errors.length - 5}개 오류` : ""
        }`,
      );
      setNotice(`상품 자동 등록 실패 · ${errors.length}개 줄을 확인해 주세요.`);
      return;
    }

    setPrizes((current) => [...current, ...parsedPrizes]);
    setBulkPrizeText("");
    setNotice(`${parsedPrizes.length}개 상품을 한 번에 등록했습니다.`);
  };

  const handleNewPrizeImageChange = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      const image = await readPrizeImageFile(file);
      setNewPrizeImage(image);
      setNewPrizeImageFile(file);
      setNotice("새 상품 이미지를 선택했습니다. 상품 추가 시 서버에 업로드됩니다.");
    } catch (error) {
      setNotice(error.message);
      window.alert(error.message);
    } finally {
      event.target.value = "";
    }
  };

  const handleManagedPrizeImageChange = async (prizeId, event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const currentPrize = prizes.find((prize) => prize.id === prizeId);

    try {
      setNotice("상품 이미지를 Supabase에 업로드하는 중...");
      const imageUrl = await uploadPrizeImage(
        user?.id,
        activeKujiId,
        prizeId,
        file,
      );

      updateManagedPrize(prizeId, "image", imageUrl);

      if (currentPrize?.image && currentPrize.image !== imageUrl) {
        deletePrizeImage(currentPrize.image).catch((error) => {
          console.warn("기존 상품 이미지 삭제 실패:", error);
        });
      }

      setNotice("상품 이미지를 변경하고 서버에 저장했습니다.");
    } catch (error) {
      console.error("상품 이미지 업로드 실패:", error);
      setNotice(`상품 이미지 업로드 실패: ${error.message}`);
      window.alert(error.message);
    } finally {
      event.target.value = "";
    }
  };

  const updateManagedPrize = (prizeId, field, value) => {
    if (field === "rarity" && usedNumbers.length === 0 && Object.keys(prizeMap).length > 0) {
      setPrizeMap({});
      localStorage.removeItem("luckykujiPrizeMap");
      setNotice("희귀도가 변경되어 기존 자동 배치를 해제했습니다. 다시 자동 배치해 주세요.");
    }

    setPrizes((current) =>
      current.map((prize) => {
        if (prize.id !== prizeId) return prize;

        if (field === "total") {
          const nextTotal = Math.max(0, Number(value) || 0);
          return {
            ...prize,
            total: nextTotal,
            remaining: Math.min(prize.remaining, nextTotal),
          };
        }

        if (field === "remaining") {
          return {
            ...prize,
            remaining: Math.max(
              0,
              Math.min(prize.total, Number(value) || 0),
            ),
          };
        }

        return { ...prize, [field]: value };
      }),
    );
  };

  const moveManagedPrize = (prizeId, direction) => {
    setPrizes((current) => {
      const currentIndex = current.findIndex((prize) => prize.id === prizeId);

      if (currentIndex < 0) return current;

      const nextIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      [next[currentIndex], next[nextIndex]] = [
        next[nextIndex],
        next[currentIndex],
      ];

      return next;
    });

    setNotice(
      direction === "up"
        ? "상품을 한 칸 위로 이동했습니다. 라이브 화면 상단에 더 먼저 노출됩니다."
        : "상품을 한 칸 아래로 이동했습니다.",
    );
  };

  const deleteManagedPrize = async (prizeId) => {
    const targetPrize = prizes.find((prize) => prize.id === prizeId);

    if (!window.confirm("이 상품을 삭제할까요?")) return;

    setPrizes((current) =>
      current.filter((prize) => prize.id !== prizeId),
    );

    if (targetPrize?.image) {
      try {
        await deletePrizeImage(targetPrize.image);
      } catch (error) {
        console.warn("Storage 이미지 삭제 실패:", error);
      }
    }

    setNotice("상품과 저장된 이미지를 삭제했습니다.");
  };

  const restorePrizesFromHistory = (currentPrizes, records) => {
    const restoredCounts = (Array.isArray(records) ? records : [])
      .flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []))
      .reduce((counts, result) => {
        const key = String(result?.prizeId ?? "");
        if (key) counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {});

    return (Array.isArray(currentPrizes) ? currentPrizes : []).map((prize) => {
      const restoredCount = restoredCounts[String(prize.id)] || 0;
      if (restoredCount < 1) return prize;

      return {
        ...prize,
        remaining: Math.min(
          Math.max(0, Number(prize.total) || 0),
          Math.max(0, Number(prize.remaining) || 0) + restoredCount,
        ),
      };
    });
  };

  const getHistoryNumbers = (records) =>
    [...new Set(
      (Array.isArray(records) ? records : []).flatMap((entry) =>
        Array.isArray(entry?.numbers) ? entry.numbers.map(Number) : [],
      ),
    )].filter(Number.isInteger);

  const setNumberStatus = (number, nextUsed) => {
    if (isPreparing || isAppraising || pendingNumbers.length > 0) return;

    if (history.length > 0) {
      const message =
        "진행 기록이 있는 회차에서는 번호 상태를 직접 바꿀 수 없습니다. 마지막 추첨 되돌리기 또는 진행 기록 초기화를 사용해 주세요.";
      setNotice(message);
      window.alert(message);
      return;
    }

    setUsedNumbers((current) =>
      nextUsed
        ? [...new Set([...current, number])].sort((a, b) => a - b)
        : current.filter((item) => item !== number),
    );
  };

  const clearRecordViewHistory = () => {
    const confirmed = window.confirm(
      `${recordViewTitle}의 진행 기록을 삭제하고 해당 번호와 상품 수량도 함께 복원할까요?`,
    );

    if (!confirmed) return;

    if (recordViewKujiId === activeKujiId) {
      const drawnNumbers = getHistoryNumbers(history);
      const drawnNumberSet = new Set(drawnNumbers);

      setUsedNumbers((current) =>
        current.filter((number) => !drawnNumberSet.has(Number(number))),
      );
      setPrizes((current) => restorePrizesFromHistory(current, history));
      setHistory([]);
      setLastConfirmedNumbers([]);
      setLastPlayer("");
      setManualNumbers([]);
      clearRandomDrawLock(activeKujiId);
    } else {
      setKujiList((current) => {
        const next = current.map((kuji) => {
          if (kuji.id !== recordViewKujiId) return kuji;

          const targetHistory = Array.isArray(kuji.history) ? kuji.history : [];
          const drawnNumberSet = new Set(getHistoryNumbers(targetHistory));

          return {
            ...kuji,
            history: [],
            usedNumbers: (Array.isArray(kuji.usedNumbers) ? kuji.usedNumbers : [])
              .filter((number) => !drawnNumberSet.has(Number(number))),
            prizes: restorePrizesFromHistory(kuji.prizes, targetHistory),
            updatedAt: new Date().toLocaleString("ko-KR"),
          };
        });

        saveKujiListSafely(next, activeKujiId);
        return next;
      });
    }

    setSelectedRecordNickname("");
    setNotice(
      `${recordViewTitle}의 기록을 삭제하고 사용 번호와 상품 수량을 함께 복원했습니다.`,
    );
  };

  const clearAllDrawData = () => {
    const confirmed = window.confirm(
      "개봉 번호, 기록, 대기열을 모두 초기화하고 지급된 상품 수량도 복원할까요? 상품 설정과 자동 배치는 유지됩니다.",
    );

    if (!confirmed) return;

    setPrizes((current) => restorePrizesFromHistory(current, history));
    setUsedNumbers([]);
    setHistory([]);
    setParticipantQueue([]);
    setManualNumbers([]);
    setLastConfirmedNumbers([]);
    setLastPlayer("");
    setPendingNumbers([]);
    setPendingPlayer("");
    setPendingMode("");
    clearRandomDrawLock(activeKujiId);
    setNotice("개봉 데이터와 기록을 초기화하고 상품 수량을 복원했습니다.");
  };

  const copyAccountNumber = async () => {
    const accountNumber = "3022153542411";

    try {
      await navigator.clipboard.writeText(accountNumber);
      setNotice("✅ 계좌번호가 복사되었습니다.");
    } catch {
      const temporaryInput = document.createElement("textarea");
      temporaryInput.value = accountNumber;
      temporaryInput.style.position = "fixed";
      temporaryInput.style.opacity = "0";
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      document.execCommand("copy");
      document.body.removeChild(temporaryInput);
      setNotice("✅ 계좌번호가 복사되었습니다.");
    }
  };

  const logout = async () => {
    try {
      await onLogout();
    } catch (logoutError) {
      console.error("로그아웃 실패:", logoutError);
      setNotice(logoutError?.message || "로그아웃 중 오류가 발생했습니다.");
    }
  };

  return (
    <main className="app-shell screenshot-shell">
      <style>{`
        /* 번호 검색 */
        .number-search-panel {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin: 12px 0 4px;
          padding: 12px;
          border: 1px solid rgba(44, 166, 255, 0.35);
          border-radius: 14px;
          background: rgba(8, 24, 39, 0.72);
        }
        .number-search-panel input {
          width: 170px;
          min-height: 42px;
          padding: 0 13px;
          border: 1px solid rgba(114, 195, 255, 0.42);
          border-radius: 10px;
          background: rgba(3, 13, 24, 0.92);
          color: #fff;
          font-size: 17px;
          font-weight: 800;
          outline: none;
        }
        .number-search-panel input:focus {
          border-color: #67d8ff;
          box-shadow: 0 0 0 3px rgba(61, 199, 255, 0.16);
        }
        .number-search-panel button {
          min-height: 42px;
          padding: 0 17px;
          border: 1px solid rgba(104, 219, 255, 0.55);
          border-radius: 10px;
          background: linear-gradient(135deg, #176b9a, #163e68);
          color: #fff;
          font-weight: 900;
          cursor: pointer;
        }
        .number-search-result {
          font-size: 14px;
          font-weight: 800;
        }
        .number-search-result.available { color: #73f2ae; }
        .number-search-result.used { color: #ff9a9a; }
        .number-search-result.error { color: #ffd36a; }
        .screenshot-number.number-search-highlight {
          position: relative;
          z-index: 3;
          border-color: #ffe66d !important;
          box-shadow: 0 0 0 4px rgba(255, 230, 109, 0.34), 0 0 26px rgba(255, 213, 62, 0.95) !important;
          animation: kuji-number-search-pulse 0.55s ease-in-out infinite alternate;
        }
        @keyframes kuji-number-search-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.09); }
        }

        /* 추첨 번호판 상태 표시 */
        .number-status-legend {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 18px;
          margin: 10px 0 12px;
          padding: 10px 14px;
          width: fit-content;
          max-width: 100%;
          border: 1px solid rgba(42, 116, 170, 0.42);
          border-radius: 12px;
          background: rgba(3, 17, 31, 0.72);
          box-sizing: border-box;
        }

        .number-status-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: rgba(229, 241, 250, 0.92);
          font-size: 13px;
          font-weight: 800;
          white-space: nowrap;
        }

        .number-status-dot {
          width: 13px;
          height: 13px;
          flex: 0 0 13px;
          border-radius: 999px;
          box-shadow: 0 0 12px currentColor;
        }

        .number-status-dot.available {
          color: #20a8ff;
          background: #20a8ff;
        }

        .number-status-dot.sold {
          color: #ff414d;
          background: #ff414d;
        }

        .number-status-dot.selected {
          color: #47df72;
          background: #47df72;
        }

        /* 번호판 스크롤바 */
        .screenshot-number-board {
          scrollbar-width: thin;
          scrollbar-color: rgba(63, 148, 211, 0.78) transparent;
          scrollbar-gutter: stable;
        }

        .screenshot-number-board::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .screenshot-number-board::-webkit-scrollbar-track {
          background: transparent;
          border-radius: 999px;
        }

        .screenshot-number-board::-webkit-scrollbar-thumb {
          min-height: 42px;
          border: 2px solid transparent;
          border-radius: 999px;
          background: linear-gradient(
              180deg,
              rgba(71, 171, 239, 0.88),
              rgba(38, 82, 119, 0.92)
            )
            padding-box;
        }

        .screenshot-number-board::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(
              180deg,
              rgba(117, 205, 255, 0.98),
              rgba(50, 108, 151, 0.98)
            )
            padding-box;
        }

        .screenshot-number-board::-webkit-scrollbar-button {
          display: none;
          width: 0;
          height: 0;
        }

        .screenshot-number-board::-webkit-scrollbar-corner {
          background: transparent;
        }

        /* 선택 가능한 번호 */
        .screenshot-number {
          position: relative;
          overflow: hidden;
          color: #edf7ff !important;
          border: 1px solid rgba(35, 168, 255, 0.72) !important;
          background:
            radial-gradient(circle at 50% 20%, rgba(30, 112, 168, 0.16), transparent 58%),
            linear-gradient(180deg, #0b1b2b 0%, #071421 100%) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.045),
            0 0 0 1px rgba(3, 35, 57, 0.3) !important;
          opacity: 1 !important;
          transition:
            transform 150ms ease,
            border-color 150ms ease,
            box-shadow 150ms ease,
            filter 150ms ease !important;
        }

        .screenshot-number:not(.used):not(:disabled):hover {
          transform: translateY(-2px);
          border-color: rgba(94, 204, 255, 0.98) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 0 18px rgba(25, 157, 255, 0.24) !important;
          filter: brightness(1.1);
        }

        /* 현재 선택된 번호 */
        .screenshot-number.selected,
        .screenshot-number.selected:disabled {
          color: #77f493 !important;
          border-color: #45df70 !important;
          background:
            radial-gradient(circle at 50% 25%, rgba(55, 220, 104, 0.2), transparent 62%),
            linear-gradient(180deg, #0b2a1b 0%, #071a11 100%) !important;
          box-shadow:
            inset 0 1px 0 rgba(174, 255, 198, 0.14),
            0 0 18px rgba(57, 222, 108, 0.22) !important;
        }

        /* 판매 완료 번호 */
        .screenshot-number.used,
        .screenshot-number.used:disabled {
          cursor: not-allowed !important;
          color: rgba(255, 152, 159, 0.6) !important;
          border-color: rgba(255, 54, 67, 0.9) !important;
          background:
            radial-gradient(circle at 50% 20%, rgba(255, 48, 61, 0.16), transparent 62%),
            linear-gradient(180deg, #281017 0%, #16090e 100%) !important;
          box-shadow:
            inset 0 1px 0 rgba(255, 186, 191, 0.05),
            0 0 13px rgba(255, 41, 55, 0.09) !important;
          filter: none !important;
          opacity: 1 !important;
          transform: none !important;
        }

        .sold-number-content {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: 1fr 1fr;
          align-items: center;
          justify-items: center;
          padding: 8px 0 7px;
          box-sizing: border-box;
          pointer-events: none;
        }

        .sold-number-x {
          color: #ff3f4b;
          font-size: 30px;
          line-height: 0.8;
          font-weight: 1000;
          text-shadow: 0 0 12px rgba(255, 48, 61, 0.35);
        }

        .sold-number-value {
          color: rgba(255, 158, 165, 0.62);
          font-size: 20px;
          line-height: 1;
          font-weight: 900;
        }

        @keyframes valueScanSweep {
          from { transform: translateX(0) skewX(-16deg); }
          to { transform: translateX(420%) skewX(-16deg); }
        }

        @keyframes analysisValuePop {
          0% { transform: scale(.82); opacity: .45; filter: blur(2px); }
          65% { transform: scale(1.11); opacity: 1; filter: blur(0); }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes rarityScanLine {
          0% { top: 10%; opacity: .2; }
          50% { top: 82%; opacity: 1; }
          100% { top: 10%; opacity: .2; }
        }

        @keyframes analysisRarityFlip {
          0% { transform: perspective(220px) rotateX(75deg) scale(.72); opacity: .25; }
          70% { transform: perspective(220px) rotateX(-8deg) scale(1.12); opacity: 1; }
          100% { transform: perspective(220px) rotateX(0) scale(1); opacity: 1; }
        }

        .high-rarity-overlay {
          position: absolute;
          inset: 0;
          z-index: 40;
          display: grid;
          place-items: center;
          overflow: hidden;
          pointer-events: none;
          background:
            radial-gradient(circle at center, rgba(255, 213, 76, 0.18), transparent 44%),
            rgba(2, 7, 13, 0.88);
          animation: highRarityBackdrop 1.7s ease both;
        }

        .high-rarity-flash {
          position: absolute;
          inset: 0;
          background: linear-gradient(115deg, transparent 34%, rgba(255,245,188,.9) 49%, transparent 64%);
          transform: translateX(-120%);
          animation: highRarityFlash 1.7s ease-out both;
        }

        .high-rarity-ring {
          position: absolute;
          width: 260px;
          height: 260px;
          border: 2px solid rgba(255,214,73,.7);
          border-radius: 50%;
          box-shadow: 0 0 22px rgba(255,211,69,.65), inset 0 0 22px rgba(255,211,69,.2);
        }

        .high-rarity-ring.ring-one { animation: highRarityRingOne 1.7s ease-out both; }
        .high-rarity-ring.ring-two { animation: highRarityRingTwo 1.7s ease-out both; }

        .high-rarity-content {
          position: relative;
          z-index: 2;
          min-width: min(520px, calc(100% - 40px));
          padding: 26px 36px 30px;
          text-align: center;
          border: 1px solid rgba(255,215,82,.75);
          border-radius: 22px;
          background: linear-gradient(180deg, rgba(38,28,5,.92), rgba(11,9,3,.96));
          box-shadow: 0 0 50px rgba(255,206,46,.24), inset 0 0 30px rgba(255,216,87,.08);
          animation: highRarityCard 1.7s cubic-bezier(.2,.8,.2,1) both;
        }

        .high-rarity-content span {
          display: block;
          margin-bottom: 8px;
          color: #ffd85e;
          font-size: 13px;
          font-weight: 1000;
          letter-spacing: .18em;
          text-shadow: 0 0 14px rgba(255,213,77,.6);
        }

        .high-rarity-content strong {
          display: block;
          color: #fff1a8;
          font-size: 110px;
          line-height: .9;
          font-weight: 1000;
          text-shadow: 0 0 10px #ffd54d, 0 0 32px rgba(255,205,48,.95), 0 0 72px rgba(255,170,0,.65);
          animation: highRarityLetter 1.7s ease both;
        }

        .high-rarity-content p {
          margin: 12px 0 0;
          color: rgba(255,240,177,.9);
          font-size: 16px;
          font-weight: 900;
        }

        @keyframes highRarityBackdrop {
          0% { opacity: 0; }
          12% { opacity: 1; }
          84% { opacity: 1; }
          100% { opacity: 0; }
        }

        @keyframes highRarityFlash {
          0% { transform: translateX(-120%); opacity: 0; }
          22% { opacity: 1; }
          55% { transform: translateX(120%); opacity: .8; }
          100% { transform: translateX(120%); opacity: 0; }
        }

        @keyframes highRarityRingOne {
          0% { transform: scale(.25); opacity: 0; }
          28% { opacity: 1; }
          100% { transform: scale(2.4); opacity: 0; }
        }

        @keyframes highRarityRingTwo {
          0% { transform: scale(.5); opacity: 0; }
          38% { opacity: .8; }
          100% { transform: scale(3.1); opacity: 0; }
        }

        @keyframes highRarityCard {
          0% { transform: scale(.68) rotateX(18deg); opacity: 0; filter: blur(8px); }
          20% { transform: scale(1.08) rotateX(0); opacity: 1; filter: blur(0); }
          72% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.04); opacity: 0; }
        }

        @keyframes highRarityLetter {
          0% { transform: scale(.4); opacity: 0; }
          22% { transform: scale(1.22); opacity: 1; }
          44% { transform: scale(.94); }
          62% { transform: scale(1.04); }
          100% { transform: scale(1); opacity: 1; }
        }

        @media (max-width: 760px) {
          .number-status-legend {
            gap: 12px;
          }

          .number-status-item {
            font-size: 12px;
          }

          .sold-number-x {
            font-size: 25px;
          }

          .sold-number-value {
            font-size: 17px;
          }
        }
      `}</style>
      {!isManagePage && (
      <header className="broadcast-header">
        <div className="broadcast-brand">
          <div className="broadcast-logo">
            <span>LUCKY</span>
            <b>KUJI</b>
          </div>

          {kujiList.length > 1 && (
            <div
              style={{
                position: "relative",
                marginLeft: "10px",
                zIndex: 20000,
              }}
            >
              <button
                type="button"
                onClick={() => setShowHeaderKujiMenu((current) => !current)}
                aria-haspopup="listbox"
                aria-expanded={showHeaderKujiMenu}
                aria-label="진행할 쿠지 선택"
                style={{
                  width: "clamp(180px, 22vw, 270px)",
                  height: "40px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "0 13px",
                  borderRadius: "999px",
                  border: showHeaderKujiMenu
                    ? "1px solid rgba(111, 209, 255, 0.95)"
                    : "1px solid rgba(72, 196, 255, 0.48)",
                  background:
                    "linear-gradient(135deg, rgba(17, 35, 54, 0.99), rgba(7, 18, 31, 0.99))",
                  color: "#ffffff",
                  boxShadow: showHeaderKujiMenu
                    ? "0 0 0 3px rgba(66, 190, 255, 0.14), 0 10px 24px rgba(0,0,0,.38)"
                    : "inset 0 1px 0 rgba(255,255,255,.08), 0 7px 18px rgba(0,0,0,.24)",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: "17px",
                    height: "17px",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "5px",
                    background: "linear-gradient(135deg, #ffffff, #8dd8ff)",
                    color: "#10243a",
                    fontSize: "9px",
                    flexShrink: 0,
                    transform: "rotate(45deg)",
                    boxShadow: "0 0 12px rgba(95, 202, 255, .35)",
                  }}
                >
                  <span style={{ transform: "rotate(-45deg)" }}>◆</span>
                </span>

                <strong
                  style={{
                    minWidth: 0,
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    textAlign: "left",
                    fontSize: "13px",
                    fontWeight: 850,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {roundTitle} · 진행 중
                </strong>

                <span
                  aria-hidden="true"
                  style={{
                    flexShrink: 0,
                    fontSize: "12px",
                    opacity: 0.8,
                    transform: showHeaderKujiMenu
                      ? "rotate(180deg)"
                      : "rotate(0deg)",
                    transition: "transform .18s ease",
                  }}
                >
                  ▼
                </span>
              </button>

              {showHeaderKujiMenu && (
                <div
                  role="listbox"
                  aria-label="쿠지 목록"
                  style={{
                    position: "absolute",
                    top: "48px",
                    left: 0,
                    width: "clamp(245px, 28vw, 330px)",
                    maxHeight: "320px",
                    padding: "7px",
                    overflowY: "auto",
                    borderRadius: "16px",
                    border: "1px solid rgba(93, 196, 245, 0.38)",
                    background:
                      "linear-gradient(180deg, rgba(13, 28, 44, 0.995), rgba(6, 15, 27, 0.995))",
                    boxShadow:
                      "0 20px 55px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.07)",
                    zIndex: 30000,
                  }}
                >
                  {kujiList.map((kuji) => {
                    const isActive =
                      String(kuji.id) === String(activeKujiId);
                    const kujiTotal = Math.max(
                      1,
                      Number(kuji.totalNumbers) || 1,
                    );
                    const kujiUsed = Array.isArray(kuji.usedNumbers)
                      ? kuji.usedNumbers.length
                      : 0;
                    const kujiRemaining = Math.max(
                      0,
                      kujiTotal - kujiUsed,
                    );

                    return (
                      <button
                        key={kuji.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                          if (
                            isPreparing ||
                            isAppraising ||
                            pendingNumbers.length > 0
                          ) {
                            setNotice(
                              "추첨 또는 감정 진행 중에는 쿠지를 변경할 수 없습니다.",
                            );
                            setShowHeaderKujiMenu(false);
                            return;
                          }

                          if (!isActive) {
                            activateKuji(kuji);
                          }

                          setShowHeaderKujiMenu(false);
                        }}
                        style={{
                          width: "100%",
                          minHeight: "58px",
                          display: "grid",
                          gridTemplateColumns: "12px minmax(0, 1fr) auto",
                          alignItems: "center",
                          gap: "11px",
                          padding: "10px 12px",
                          margin: 0,
                          border: "none",
                          borderRadius: "11px",
                          background: isActive
                            ? "linear-gradient(135deg, rgba(47, 155, 215, .34), rgba(34, 92, 139, .24))"
                            : "transparent",
                          color: "#ffffff",
                          cursor: "pointer",
                          textAlign: "left",
                          outline: "none",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: "9px",
                            height: "9px",
                            borderRadius: "50%",
                            background: isActive ? "#62ddff" : "#52677b",
                            boxShadow: isActive
                              ? "0 0 12px rgba(98, 221, 255, .9)"
                              : "none",
                          }}
                        />

                        <span style={{ minWidth: 0 }}>
                          <strong
                            style={{
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: "14px",
                              fontWeight: 850,
                              color: isActive ? "#ffffff" : "#eaf5ff",
                            }}
                          >
                            {kuji.title || "이름 없는 쿠지"}
                          </strong>

                          <span
                            style={{
                              display: "block",
                              marginTop: "4px",
                              fontSize: "11px",
                              color: isActive
                                ? "#9ee7ff"
                                : "rgba(211, 230, 245, .68)",
                            }}
                          >
                            {isActive
                              ? "현재 진행 중"
                              : `전체 ${kujiTotal}개 중 ${kujiRemaining}개 남음`}
                          </span>
                        </span>

                        <span
                          style={{
                            padding: "5px 8px",
                            borderRadius: "999px",
                            background: isActive
                              ? "rgba(94, 218, 255, .15)"
                              : "rgba(255,255,255,.055)",
                            color: isActive
                              ? "#9eeaff"
                              : "rgba(231, 242, 251, .78)",
                            fontSize: "11px",
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isActive ? "진행 중" : `${kujiRemaining} 남음`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="broadcast-stats" aria-label="추첨 현황">
          <div className="broadcast-stat">
            <span>진행률</span>
            <strong>{progress}%</strong>
          </div>

          <div className="broadcast-stat">
            <span>남은공</span>
            <strong>{remainingCount.toLocaleString()}</strong>
          </div>

          <div className="broadcast-stat">
            <span>개봉</span>
            <strong>{usedNumbers.length.toLocaleString()}</strong>
          </div>

          <div className="broadcast-stat">
            <span>총</span>
            <strong>{totalNumbers.toLocaleString()}</strong>
          </div>

          <div className="broadcast-stat">
            <span>랜덤</span>
            <strong>{randomCount.toLocaleString()}</strong>
          </div>

          <div className="broadcast-stat">
            <span>1회 가격</span>
            <strong
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "7px",
              }}
            >
              {price.toLocaleString()}

              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="21"
                height="21"
                style={{
                  display: "block",
                  flexShrink: 0,
                  filter: "drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35))",
                }}
              >
                <defs>
                  <radialGradient id="priceCoinFill" cx="34%" cy="28%" r="72%">
                    <stop offset="0%" stopColor="#fff8ad" />
                    <stop offset="35%" stopColor="#ffd94f" />
                    <stop offset="72%" stopColor="#f0ad16" />
                    <stop offset="100%" stopColor="#b86b00" />
                  </radialGradient>
                  <linearGradient id="priceCoinRim" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#fff17a" />
                    <stop offset="48%" stopColor="#f4bd22" />
                    <stop offset="100%" stopColor="#9d5700" />
                  </linearGradient>
                </defs>

                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  fill="url(#priceCoinRim)"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="7.8"
                  fill="url(#priceCoinFill)"
                  stroke="#ffe477"
                  strokeWidth="0.8"
                />
                <path
                  d="M12 7.2v9.6M9.4 9.2h4.1c1.35 0 2.3.72 2.3 1.82 0 1.1-.95 1.82-2.3 1.82h-3c-1.35 0-2.3.72-2.3 1.82 0 1.1.95 1.82 2.3 1.82h4.2"
                  fill="none"
                  stroke="#8a5000"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7.2 5.8c1.25-1.15 2.8-1.75 4.8-1.75"
                  fill="none"
                  stroke="#fff7bc"
                  strokeWidth="1.15"
                  strokeLinecap="round"
                  opacity="0.9"
                />
              </svg>
            </strong>
          </div>
        </div>

        <div className="broadcast-header-actions">
          <button
            type="button"
            className="broadcast-account"
            onClick={copyAccountNumber}
            title="계좌번호 복사"
          >
            <span className="broadcast-bank">NH농협은행</span>
            <strong>302-2153-5424-11</strong>
            <span className="broadcast-owner">이X민</span>
            <span className="broadcast-copy">복사</span>
          </button>

          <button
  type="button"
  className="header-manage-button"
  onClick={() => {
    window.location.href = "/manage";
  }}
>
  <span>▦</span>
  관리 열기
</button>

          <button
            type="button"
            className="header-prize-button"
            onClick={() => setIsPrizePanelOpen(true)}
          >
            <span>🎁</span>
            상품 패널
          </button>

          <button
            type="button"
            className="header-setting-button"
            onClick={() => setShowSettings(true)}
            aria-label="설정"
          >
            ⚙
          </button>
        </div>
      </header>
      )}

      {isManagePage && (
        <aside className="management-sidebar">
          <div className="management-brand">
            <span>LUCKY KUJI</span>
            <strong>CONTROL</strong>
          </div>

          <nav aria-label="관리 메뉴">
            {[
              ["kuji", "◆", "쿠지 관리"],
              ["prizes", "🎁", "상품 관리"],
              ["records", "☷", "진행 기록"],
            ].map(([tabId, icon, label]) => (
              <button
                type="button"
                key={tabId}
                className={activeTab === tabId ? "active" : ""}
                onClick={() => setActiveTab(tabId)}
              >
                <span>{icon}</span>
                <b>{label}</b>
              </button>
            ))}
          </nav>

          <button
            type="button"
            className="sidebar-live-button"
           onClick={() => {
  window.location.href = "/";
}}
          >
            <span>●</span>
            라이브 화면 열기
          </button>
        </aside>
      )}

      {false && (
      <nav className="control-tabs removed-control-tabs" aria-label="관리 메뉴">
        {[
          ["live", "●", "라이브 진행"],
          ["kuji", "◆", "쿠지 관리"],
          ["prizes", "🎁", "상품 관리"],
          ["records", "☷", "기록"],
        ].map(([tabId, icon, label]) => (
          <button
            type="button"
            key={tabId}
            className={activeTab === tabId ? "active" : ""}
            onClick={() => setActiveTab(tabId)}
          >
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
      )}

      {!isManagePage && (
      <section className="screenshot-layout">
        <section className="screenshot-main-panel">
          <div className="draw-title-block">
            <div className="draw-live-row">
              <span className="draw-live-badge">LIVE</span>
              <strong>실시간 추첨 진행 중</strong>
            </div>

            <h1>{roundTitle}</h1>
          </div>

          {/* QUEUE는 남는 너비 전체, 우측 추첨 패널은 190px 고정 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 190px",
              alignItems: "start",
              columnGap: "12px",
              width: "100%",
              minWidth: 0,
              marginBottom: "18px",
              boxSizing: "border-box",
            }}
          >
          <section
            style={{
              width: "100%",
              minWidth: 0,
              maxWidth: "100%",
              alignSelf: "stretch",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "block",
                width: "100%",
                minWidth: "100%",
                maxWidth: "none",
                boxSizing: "border-box",
                padding: "11px 12px",
                borderRadius: "14px",
                border: "1px solid rgba(112, 132, 165, 0.16)",
                background:
                  "linear-gradient(180deg, rgba(12, 20, 34, 0.98), rgba(8, 15, 27, 0.98))",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.025), 0 14px 34px rgba(0,0,0,0.16)",
                overflow: "hidden",
                minHeight: "0",
                height: "auto",
              }}
            >
              {/* 대기열 추가 + 참가자 목록 */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(160px, 240px) minmax(0, 1fr)",
                  alignItems: "center",
                  columnGap: "9px",
                  width: "100%",
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    padding: "0 4px",
                    color: "rgba(174, 187, 209, 0.7)",
                    fontSize: "9px",
                    fontWeight: 900,
                    letterSpacing: "0.12em",
                  }}
                >
                  QUEUE
                </span>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    minWidth: 0,
                    minHeight: "40px",
                    overflow: "hidden",
                    borderRadius: "11px",
                    border: "1px solid rgba(105, 126, 160, 0.22)",
                    background: "rgba(5, 12, 23, 0.72)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025)",
                  }}
                >
                  <input
                    type="text"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addParticipantToQueue();
                      }
                    }}
                    placeholder="닉네임"
                    disabled={isPreparing || isAppraising}
                    style={{
                      width: "100%",
                      minWidth: 0,
                      height: "38px",
                      padding: "0 12px",
                      border: 0,
                      outline: 0,
                      background: "transparent",
                      color: "#f1f5f9",
                      fontSize: "20px",
                      fontWeight: 700,
                    }}
                  />

                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "center",
                    flexWrap: "nowrap",
                    gap: participantQueue.length >= 10 ? "3px" : "5px",
                    width: "100%",
                    minWidth: 0,
                    maxWidth: "100%",
                    overflow: "hidden",
                    padding: "3px 2px 5px 1px",
                    boxSizing: "border-box",
                  }}
                >
                  {participantQueue.length === 0 ? (
                    <span
                      style={{
                        padding: "8px 11px",
                        color: "rgba(148, 163, 184, 0.48)",
                        fontSize: "11px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      대기 중인 참가자가 없습니다.
                    </span>
                  ) : (
                    participantQueue.map((participant, index) => (
                      <div
                        key={participant.id}
                        draggable={canReorderQueue}
                        onDragStart={(event) =>
                          handleHorizontalQueueDragStart(event, participant.id)
                        }
                        onDragOver={(event) =>
                          handleHorizontalQueueDragOver(event, participant.id)
                        }
                        onDrop={(event) => {
                          event.preventDefault();
                          finishHorizontalQueueDrag();
                        }}
                        onDragEnd={finishHorizontalQueueDrag}
                        title={`${participant.nickname} · 좌우로 드래그해 순서 변경`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap:
                            participantQueue.length >= 10
                              ? "2px"
                              : participantQueue.length >= 7
                                ? "3px"
                                : "6px",
                          flex: "0 0 auto",
                          minWidth:
                            participantQueue.length >= 12
                              ? "44px"
                              : participantQueue.length >= 9
                                ? "52px"
                                : "64px",
                          minHeight: "34px",
                          whiteSpace: "nowrap",
                          maxWidth:
                            participantQueue.length >= 12
                              ? "78px"
                              : participantQueue.length >= 8
                                ? "96px"
                                : "166px",
                          padding:
                            participantQueue.length >= 10
                              ? "0 3px"
                              : participantQueue.length >= 7
                                ? "0 5px"
                                : "0 9px",
                          overflow: "hidden",
                          borderRadius: "999px",
                          border:
                            index === 0
                              ? "1px solid rgba(248, 81, 73, 0.82)"
                              : dragOverParticipantId === participant.id &&
                                  draggedParticipantId !== participant.id
                                ? "1px solid rgba(116, 146, 255, 0.8)"
                                : "1px solid rgba(112, 132, 165, 0.2)",
                          background:
                            index === 0
                              ? "linear-gradient(180deg, rgba(91, 31, 39, 0.48), rgba(45, 18, 27, 0.58))"
                              : "linear-gradient(180deg, rgba(19, 29, 47, 0.94), rgba(11, 19, 33, 0.94))",
                          boxShadow:
                            index === 0
                              ? "0 0 0 1px rgba(248, 81, 73, 0.12), 0 6px 16px rgba(0,0,0,0.2)"
                              : "inset 0 1px 0 rgba(255,255,255,0.025)",
                          opacity:
                            draggedParticipantId === participant.id ? 0.42 : 1,
                          transform:
                            dragOverParticipantId === participant.id &&
                            draggedParticipantId !== participant.id
                              ? "translateY(-1px) scale(1.025)"
                              : "translateY(0) scale(1)",
                          transition:
                            "transform 120ms ease, opacity 120ms ease, border-color 120ms ease",
                          cursor: canReorderQueue ? "grab" : "default",
                          userSelect: "none",
                        }}
                      >
                        {participantQueue.length < 9 && (
                          <span
                            aria-hidden="true"
                            style={{
                              color: "rgba(156, 173, 203, 0.52)",
                              fontSize: "12px",
                              letterSpacing: "-3px",
                              flexShrink: 0,
                            }}
                          >
                            ⠿
                          </span>
                        )}

                        {participantQueue.length < 12 && (
                          <span
                            style={{
                              color:
                                index === 0
                                  ? "rgba(255, 148, 139, 0.72)"
                                  : "rgba(148, 163, 184, 0.52)",
                              fontSize:
                                participantQueue.length >= 9 ? "8px" : "9px",
                              fontWeight: 900,
                              flexShrink: 0,
                            }}
                          >
                            {participantQueue.length >= 9
                              ? index + 1
                              : String(index + 1).padStart(2, "0")}
                          </span>
                        )}

                        <strong
                          style={{
                            flex: "1 1 auto",
                            minWidth: 0,
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textAlign: "center",
                            color:
                              index === 0
                                ? "rgba(255, 121, 112, 0.98)"
                                : "rgba(226, 232, 240, 0.92)",
                            fontSize:
                              participantQueue.length >= 12
                                ? "9px"
                                : participantQueue.length >= 8
                                  ? "10px"
                                  : "11px",
                            fontWeight: 850,
                            pointerEvents: "none",
                          }}
                        >
                          {participant.nickname}
                        </strong>

                        <button
                          type="button"
                          aria-label={`${participant.nickname}님 대기열에서 삭제`}
                          title="대기열에서 삭제"
                          onMouseDown={(event) => event.stopPropagation()}
                          onDragStart={(event) => event.preventDefault()}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeParticipantFromQueue(participant.id);
                          }}
                          disabled={
                            isPreparing ||
                            isAppraising ||
                            pendingNumbers.length > 0
                          }
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width:
                              participantQueue.length >= 10 ? "16px" : "20px",
                            minWidth:
                              participantQueue.length >= 10 ? "16px" : "20px",
                            height:
                              participantQueue.length >= 10 ? "16px" : "20px",
                            padding: 0,
                            flexShrink: 0,
                            borderRadius: "7px",
                            border: "1px solid rgba(130, 147, 177, 0.16)",
                            background: "rgba(8, 15, 27, 0.6)",
                            color: "rgba(174, 187, 209, 0.56)",
                            fontSize: "12px",
                            lineHeight: 1,
                            cursor:
                              isPreparing ||
                              isAppraising ||
                              pendingNumbers.length > 0
                                ? "not-allowed"
                                : "pointer",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>


              </div>

              {/* 현재 진행 중인 참가자 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  marginTop: "10px",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    padding: "0 4px",
                    color: "rgba(174, 187, 209, 0.7)",
                    fontSize: "9px",
                    fontWeight: 900,
                    letterSpacing: "0.12em",
                  }}
                >
                  EXPERT
                </span>

                {participantQueue.length > 0 ? (
                  <>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        minHeight: "38px",
                        maxWidth: "310px",
                        padding: "0 14px",
                        borderRadius: "11px",
                        border: "1px solid rgba(112, 132, 165, 0.2)",
                        background:
                          "linear-gradient(180deg, rgba(18, 28, 46, 0.96), rgba(10, 18, 31, 0.96))",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.025)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          color: "#d6aa3c",
                          fontSize: "16px",
                          lineHeight: 1,
                        }}
                      >
                        ♙
                      </span>

                      <span
                        style={{
                          color: "rgba(148, 163, 184, 0.7)",
                          fontSize: "10px",
                          fontWeight: 800,
                        }}
                      >
                        진행 중
                      </span>

                      <strong
                        title={participantQueue[0].nickname}
                        style={{
                          maxWidth: "180px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "rgba(241, 245, 249, 0.96)",
                          fontSize: "20px",
                          fontWeight: 900,
                        }}
                      >
                        {participantQueue[0].nickname}
                      </strong>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        removeParticipantFromQueue(participantQueue[0].id)
                      }
                      disabled={
                        isPreparing ||
                        isAppraising ||
                        pendingNumbers.length > 0
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "7px",
                        minHeight: "38px",
                        padding: "0 14px",
                        borderRadius: "11px",
                        border: "1px solid rgba(112, 132, 165, 0.14)",
                        background: "rgba(18, 27, 44, 0.58)",
                        color: "rgba(148, 163, 184, 0.62)",
                        fontSize: "11px",
                        fontWeight: 800,
                        cursor:
                          isPreparing ||
                          isAppraising ||
                          pendingNumbers.length > 0
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          isPreparing ||
                          isAppraising ||
                          pendingNumbers.length > 0
                            ? 0.42
                            : 1,
                      }}
                    >
                      <span aria-hidden="true" style={{ fontSize: "14px" }}>
                        ×
                      </span>
                      해제
                    </button>
                  </>
                ) : (
                  <div
                    style={{
                      minHeight: "38px",
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "0 14px",
                      borderRadius: "11px",
                      border: "1px dashed rgba(112, 132, 165, 0.16)",
                      color: "rgba(148, 163, 184, 0.42)",
                      fontSize: "11px",
                    }}
                  >
                    현재 진행 중인 참가자가 없습니다.
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setParticipantQueue([])}
                  disabled={
                    participantQueue.length === 0 ||
                    isPreparing ||
                    isAppraising ||
                    pendingNumbers.length > 0
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    minHeight: "36px",
                    marginLeft: "auto",
                    padding: "0 12px",
                    borderRadius: "10px",
                    border: "1px solid rgba(112, 132, 165, 0.16)",
                    background: "rgba(11, 19, 33, 0.74)",
                    color: "rgba(174, 187, 209, 0.62)",
                    fontSize: "10px",
                    fontWeight: 800,
                    cursor:
                      participantQueue.length === 0 ||
                      isPreparing ||
                      isAppraising ||
                      pendingNumbers.length > 0
                        ? "not-allowed"
                        : "pointer",
                    opacity:
                      participantQueue.length === 0 ||
                      isPreparing ||
                      isAppraising ||
                      pendingNumbers.length > 0
                        ? 0.4
                        : 1,
                  }}
                >
                  <span aria-hidden="true">↻</span>
                  전체 초기화
                </button>
              </div>

            </div>
          </section>


          <aside
            aria-label="추첨 실행 버튼"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignSelf: "start",
              gap: "12px",
              width: "190px",
              minWidth: "190px",
              maxWidth: "190px",
              boxSizing: "border-box",
              marginTop: 0,
              transform: "translateY(-78px)",
              padding: "14px",
              borderRadius: "16px",
              border: "1px solid rgba(112, 132, 165, 0.18)",
              background:
                "linear-gradient(180deg, rgba(11, 19, 32, 0.98), rgba(7, 14, 25, 0.98))",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.03), 0 18px 36px rgba(0,0,0,0.24)",
            }}
          >
                  <button
                    type="button"
                    className="clear-selection-button"
                    onClick={() => {
                      setManualNumbers([]);
                      setNotice("선택한 번호를 모두 해제했습니다.");
                    }}
                    disabled={
                      manualNumbers.length === 0 ||
                      isPreparing ||
                      isAppraising ||
                      pendingNumbers.length > 0
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      minHeight: "52px",
                      padding: "0 18px",
                      borderRadius: "12px",
                      border: "1px solid rgba(112, 132, 165, 0.24)",
                      background:
                        "linear-gradient(180deg, rgba(17, 27, 44, 0.98), rgba(9, 17, 30, 0.98))",
                      color: "rgba(190, 202, 222, 0.86)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.035), 0 8px 20px rgba(0,0,0,0.18)",
                      fontSize: "12px",
                      fontWeight: 900,
                      cursor:
                        manualNumbers.length === 0 ||
                        isPreparing ||
                        isAppraising ||
                        pendingNumbers.length > 0
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        manualNumbers.length === 0 ||
                        isPreparing ||
                        isAppraising ||
                        pendingNumbers.length > 0
                          ? 0.45
                          : 1,
                      transition:
                        "transform 140ms ease, border-color 140ms ease, filter 140ms ease",
                    }}
                    onMouseEnter={(event) => {
                      if (!event.currentTarget.disabled) {
                        event.currentTarget.style.transform = "translateY(-1px)";
                        event.currentTarget.style.borderColor =
                          "rgba(148, 163, 184, 0.42)";
                        event.currentTarget.style.filter = "brightness(1.08)";
                      }
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.transform = "translateY(0)";
                      event.currentTarget.style.borderColor =
                        "rgba(112, 132, 165, 0.24)";
                      event.currentTarget.style.filter = "brightness(1)";
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: "16px" }}>
                      ↻
                    </span>
                    선택 초기화
                  </button>

                  <button
                    type="button"
                    className={[
                      "manual-analysis-button",
                      manualNumbers.length === 1
                        ? "single-draw-button"
                        : "multi-draw-button",
                    ].join(" ")}
                    onClick={prepareManualAppraisal}
                    disabled={
                      !currentParticipant ||
                      manualNumbers.length < 1 ||
                      isPreparing ||
                      isAppraising ||
                      pendingNumbers.length > 0
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      minHeight: "56px",
                      padding: "0 18px",
                      borderRadius: "12px",
                      border: "1px solid rgba(220, 75, 101, 0.56)",
                      background:
                        "linear-gradient(180deg, rgba(132, 42, 61, 0.98), rgba(91, 27, 43, 0.98))",
                      color: "rgba(255, 239, 242, 0.98)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.11), 0 10px 24px rgba(115,30,49,0.2)",
                      fontSize: "12px",
                      fontWeight: 900,
                      cursor:
                        !currentParticipant ||
                        manualNumbers.length < 1 ||
                        isPreparing ||
                        isAppraising ||
                        pendingNumbers.length > 0
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        !currentParticipant ||
                        manualNumbers.length < 1 ||
                        isPreparing ||
                        isAppraising ||
                        pendingNumbers.length > 0
                          ? 0.48
                          : 1,
                      transition:
                        "transform 140ms ease, filter 140ms ease, box-shadow 140ms ease",
                    }}
                    onMouseEnter={(event) => {
                      if (!event.currentTarget.disabled) {
                        event.currentTarget.style.transform = "translateY(-2px)";
                        event.currentTarget.style.filter = "brightness(1.1)";
                        event.currentTarget.style.boxShadow =
                          "inset 0 1px 0 rgba(255,255,255,0.14), 0 14px 30px rgba(115,30,49,0.3)";
                      }
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.transform = "translateY(0)";
                      event.currentTarget.style.filter = "brightness(1)";
                      event.currentTarget.style.boxShadow =
                        "inset 0 1px 0 rgba(255,255,255,0.11), 0 10px 24px rgba(115,30,49,0.2)";
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: "15px" }}>
                      ✦
                    </span>
                    {manualNumbers.length === 1
                      ? "1개 추첨"
                      : manualNumbers.length > 1
                        ? `${manualNumbers.length}개 동시추첨`
                        : "선택 번호 추첨"}
                  </button>

                  <button
                    type="button"
                    className="start-analysis-button random-number-picker-button"
                    onClick={openRandomNumberPicker}
                    disabled={
                      !currentParticipant ||
                      isPreparing ||
                      isAppraising ||
                      pendingNumbers.length > 0
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      minHeight: "56px",
                      padding: "0 18px",
                      borderRadius: "12px",
                      border: "1px solid rgba(56, 189, 248, 0.76)",
                      background:
                        "linear-gradient(180deg, rgba(10, 145, 190, 0.99), rgba(3, 91, 132, 0.99))",
                      color: "#ffffff",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.2), 0 12px 26px rgba(2,132,199,0.24)",
                      fontSize: "12px",
                      fontWeight: 900,
                      cursor:
                        !currentParticipant ||
                        isPreparing ||
                        isAppraising ||
                        pendingNumbers.length > 0
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        !currentParticipant ||
                        isPreparing ||
                        isAppraising ||
                        pendingNumbers.length > 0
                          ? 0.48
                          : 1,
                      transition:
                        "transform 140ms ease, filter 140ms ease, box-shadow 140ms ease",
                    }}
                    onMouseEnter={(event) => {
                      if (!event.currentTarget.disabled) {
                        event.currentTarget.style.transform = "translateY(-2px)";
                        event.currentTarget.style.filter = "brightness(1.1)";
                        event.currentTarget.style.boxShadow =
                          "inset 0 1px 0 rgba(255,255,255,0.22), 0 16px 34px rgba(2,132,199,0.34)";
                      }
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.transform = "translateY(0)";
                      event.currentTarget.style.filter = "brightness(1)";
                      event.currentTarget.style.boxShadow =
                        "inset 0 1px 0 rgba(255,255,255,0.2), 0 12px 26px rgba(2,132,199,0.24)";
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: "17px" }}>
                      ⟳
                    </span>
                    번호 랜덤 추첨
                  </button>
          </aside>
          </div>

          <section
            className="number-workspace"
            style={{ width: "100%", clear: "both", marginTop: "4px" }}
          >
            <div className="number-workspace-head">
              <div>
                <h2>추첨 번호판 (1 ~ {totalNumbers})</h2>
                <p className="multi-select-guide">
                  직접 선택하거나 번호 랜덤 추첨으로 번호만 먼저 뽑을 수 있습니다. 상품 추첨은 별도로 진행됩니다.
                  {currentParticipant && (
                    <b>
                      {" "}현재 {manualNumbers.length}개 선택
                    </b>
                  )}
                </p>
              </div>

              <div className="number-workspace-actions">
                <button type="button" onClick={undoLastDraw}>
                  마지막 실행 취소
                </button>
                <button type="button" onClick={() => setShowHistory(true)}>
                  진행 기록
                </button>
              </div>
            </div>

            <form
              className="number-search-panel"
              onSubmit={(event) => {
                event.preventDefault();
                searchNumber();
              }}
            >
              <input
                type="number"
                min="1"
                max={totalNumbers}
                inputMode="numeric"
                value={numberSearchValue}
                onChange={(event) => {
                  setNumberSearchValue(event.target.value);
                  setNumberSearchResult(null);
                }}
                placeholder={`번호 검색 (1~${totalNumbers})`}
                aria-label="추첨 번호 검색"
              />
              <button type="submit">🔍 번호 찾기</button>
              {numberSearchResult && (
                <span className={`number-search-result ${numberSearchResult.type}`}>
                  {numberSearchResult.message}
                </span>
              )}
            </form>

            <div className="number-status-legend" aria-label="번호 상태 안내">
              <span className="number-status-item">
                <span className="number-status-dot available" aria-hidden="true" />
                선택 가능
              </span>
              <span className="number-status-item">
                <span className="number-status-dot sold" aria-hidden="true" />
                판매 완료
              </span>
              <span className="number-status-item">
                <span className="number-status-dot selected" aria-hidden="true" />
                선택됨
              </span>
            </div>

            <div
              className="screenshot-number-board"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                gap: "9px",
                alignItems: "stretch",
              }}
            >
              {allNumbers.map((number) => {
                const isUsed = usedNumbers.includes(number);
                const isManualSelected = manualNumbers.includes(number);

                return (
                  <button
                    type="button"
                    key={number}
                    className={[
                      "screenshot-number",
                      isUsed ? "used" : "",
                      isManualSelected ? "selected" : "",
                      lastConfirmedNumbers.includes(number) ? "recent" : "",
                      highlightedNumber === number ? "number-search-highlight" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    data-kuji-number={number}
                    onClick={() => toggleManualNumber(number)}
                    disabled={
                      isUsed ||
                      isPreparing ||
                      isAppraising ||
                      pendingNumbers.length > 0
                    }
                    style={{
                      width: "100%",
                      minWidth: "72px",
                      height: "72px",
                      minHeight: "72px",
                      padding: 0,
                      borderRadius: "12px",
                      fontSize: number >= 100 ? "22px" : "27px",
                      lineHeight: 1,
                      fontWeight: 900,
                      display: "grid",
                      placeItems: "center",
                      boxSizing: "border-box",
                    }}
                  >
                    {isUsed ? (
                      <span className="sold-number-content" aria-label={`${number}번 판매 완료`}>
                        <span className="sold-number-x" aria-hidden="true">×</span>
                        <span className="sold-number-value">{number}</span>
                      </span>
                    ) : (
                      number
                    )}
                  </button>
                );
              })}
            </div>
          </section>

        </section>

        <aside className="screenshot-prize-sidebar">
          <div className="screenshot-prize-head">
            <div>
              <span>LIVE PRIZE STOCK</span>
              <h2>현재 남은 상품</h2>
            </div>

            <button
              type="button"
              onClick={() => setIsPrizePanelOpen(true)}
            >
              전체 내역 보기
            </button>
          </div>

          <div className="screenshot-prize-list">
            {sortedEffectivePrizes
              .filter((prize) => !prize.isCoupon)
              .map((prize, index) => {
                const isSoldOut = prize.remaining <= 0;
                const accent = getPrizeAccent(prize, index);

                return (
                  <article
                    className={[
                      "screenshot-prize-card",
                      `accent-${accent}`,
                      isSoldOut ? "sold-out" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={prize.id}
                    style={{
                      position: "relative",
                      display: "grid",
                      gridTemplateColumns: "96px minmax(0, 1fr) auto",
                      alignItems: "center",
                      columnGap: "14px",
                      width: "100%",
                      minHeight: "116px",
                      padding: "10px 14px",
                      boxSizing: "border-box",
                      overflow: "hidden",
                      ...(prize.featured
                        ? {
                            border: "1px solid rgba(255, 70, 88, 0.95)",
                            background:
                              "linear-gradient(135deg, rgba(88, 13, 25, 0.95), rgba(30, 8, 16, 0.96))",
                            boxShadow:
                              "0 0 0 1px rgba(255, 70, 88, 0.12), 0 0 24px rgba(255, 40, 70, 0.18)",
                          }
                        : {}),
                    }}
                  >
                    {prize.featured && (
                      <span style={{
                        position: "absolute", top: "8px", right: "10px", zIndex: 2,
                        padding: "4px 8px", borderRadius: "999px",
                        background: "rgba(255, 50, 72, 0.96)", color: "#fff",
                        fontSize: "9px", fontWeight: 950, letterSpacing: "0.04em",
                        boxShadow: "0 4px 12px rgba(255, 35, 65, 0.3)",
                      }}></span>
                    )}
                    <div
                      className="prize-box-thumb"
                      style={{
                        width: "96px",
                        minWidth: "96px",
                        height: "96px",
                        minHeight: "96px",
                        overflow: "hidden",
                        padding: 0,
                        borderRadius: "11px",
                        boxSizing: "border-box",
                        background: "#ffffff",
                      }}
                    >
                      {prize.image ? (
                        <img
                          src={prize.image}
                          alt={prize.name}
                          style={{
                            display: "block",
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            objectPosition: "center",
                            
                            transformOrigin: "center",
                          }}
                        />
                      ) : (
                        <span>{String(prize.name).slice(0, 2)}</span>
                      )}
                    </div>

                    <div
                      className="screenshot-prize-info"
                      style={{
                        minWidth: 0,
                        overflow: "visible",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        gap: "7px",
                      }}
                    >
                      <strong
                        style={{
                          display: "block",
                          minWidth: 0,
                          fontSize: "15px",
                          lineHeight: 1.25,
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                          wordBreak: "keep-all",
                        }}
                      >
                        {prize.name}
                      </strong>
                      <span
                        style={{
                          display: "block",
                          fontSize: "11px",
                          lineHeight: 1.2,
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {prize.grade}
                      </span>
                    </div>

                    <div
                      className="screenshot-prize-count"
                      style={{
                        minWidth: "92px",
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "flex-end",
                        gap: "3px",
                        whiteSpace: "nowrap",
                        overflow: "visible",
                      }}
                    >
                      <strong>{prize.remaining}</strong>
                      <span>/ {prize.total}개</span>
                    </div>
                  </article>
                );
              })}
          </div>

        </aside>
      </section>
      )}

      {isManagePage && activeTab === "kuji" && (
        <section className="management-page">
          <div className="management-page-heading">
            <div>
              <span>KUJI CONTROL</span>
              <h1>쿠지 관리</h1>
              <p>현재 진행할 쿠지의 기본 정보와 전체 수량을 설정합니다.</p>
            </div>
            <div className="management-heading-actions">
              <button type="button" className="danger-outline" onClick={clearAllDrawData}>
                개봉 기록 초기화
              </button>
              <button
  type="button"
  className="primary-action"
  onClick={() => {
    window.location.href = "/";
  }}
>
  라이브 화면 열기
</button>
            </div>
          </div>

          <div className="new-kuji-layout">
            <article className="management-card new-kuji-card">
              <div className="management-card-title">
                <span>NEW</span>
                <div>
                  <h2>새 쿠지 오픈</h2>
                  <p>쿠지를 먼저 만든 뒤 상품 관리에서 해당 쿠지만의 보상을 따로 등록합니다.</p>
                </div>
              </div>

              <div className="new-kuji-form">
                <label className="new-kuji-title-field">
                  새 쿠지 이름
                  <input
                    value={newKujiTitle}
                    onChange={(event) => setNewKujiTitle(event.target.value)}
                    placeholder="예: 7월 2차 럭키쿠지"
                  />
                </label>

                <label>
                  한 줄 가격
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="0"
                      value={newKujiPrice}
                      onChange={(event) =>
                        setNewKujiPrice(Math.max(0, Number(event.target.value) || 0))
                      }
                    />
                    <span>원</span>
                  </div>
                </label>

                <label>
                  전체 번호 수
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="1"
                      value={newKujiTotalNumbers}
                      onChange={(event) =>
                        setNewKujiTotalNumbers(
                          Math.max(1, Number(event.target.value) || 1),
                        )
                      }
                    />
                    <span>개</span>
                  </div>
                </label>

                <div className="new-kuji-quantity-check matched">
                  <div>
                    <span>전체 번호</span>
                    <strong>{requestedNewKujiTotal}개</strong>
                  </div>
                  <b>→</b>
                  <div>
                    <span>보상 설정</span>
                    <strong>쿠지별 개별 관리</strong>
                  </div>
                  <p>
                    생성 후 상품 관리에서 이 쿠지에만 적용되는 보상을 등록하세요.
                  </p>
                </div>

                <button
                  type="button"
                  className="open-new-kuji-button"
                  onClick={openNewKuji}
                >
                  새 쿠지 만들기
                </button>
              </div>
            </article>

            <article className="management-card saved-kuji-card">
              <div className="management-card-title">
                <span>LIST</span>
                <div>
                  <h2>쿠지 목록</h2>
                  <p>저장된 쿠지를 다시 선택해 이어서 진행할 수 있습니다.</p>
                </div>
              </div>

              <div className="saved-kuji-list">
                {kujiList
                  .slice()
                  .sort((a, b) => (a.id === activeKujiId ? -1 : b.id === activeKujiId ? 1 : 0))
                  .map((kuji) => (
                    <div
                      className={`saved-kuji-row ${kuji.id === activeKujiId ? "active" : ""}`}
                      key={kuji.id}
                    >
                      <div>
                        <strong>{kuji.title}</strong>
                        <span>
                          {(Number(kuji.price) || 0).toLocaleString()}원 · 총 {kuji.totalNumbers}개
                        </span>
                      </div>
                      <div className="saved-kuji-progress">
                        <span>
                          개봉 {Array.isArray(kuji.usedNumbers) ? kuji.usedNumbers.length : 0}개
                        </span>
                        <small>{kuji.updatedAt || "저장됨"}</small>
                      </div>
                      {kuji.id === activeKujiId ? (
                        <b className="active-kuji-badge">오픈 중</b>
                      ) : (
                        <div className="saved-kuji-actions">
                          <button type="button" onClick={() => activateKuji(kuji)}>
                            이 쿠지 오픈
                          </button>
                          <button
                            type="button"
                            className="delete-kuji-button"
                            onClick={() => deleteSavedKuji(kuji.id)}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </article>
          </div>

          <div className="management-grid kuji-management-grid">
            <article className="management-card">
              <div className="management-card-title">
                <span>01</span>
                <div>
                  <h2>기본 정보</h2>
                  <p>방송 화면에 바로 반영됩니다.</p>
                </div>
              </div>

              <div className="management-form-grid">
                <label className="wide-field">
                  쿠지 이름
                  <input
                    value={roundTitle}
                    onChange={(event) => setRoundTitle(event.target.value)}
                    placeholder="예: 제2회 럭키쿠지"
                  />
                </label>

                <label>
                  한 줄 가격
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="0"
                      value={price}
                      onChange={(event) => setPrice(Math.max(0, Number(event.target.value) || 0))}
                    />
                    <span>원</span>
                  </div>
                </label>

                <label>
                  전체 번호 수
                  <div className="input-with-unit">
                    <input
                      type="number"
                      min="1"
                      value={totalNumbers}
                      onChange={(event) =>
                        setTotalNumbers(Math.max(1, Number(event.target.value) || 1))
                      }
                    />
                    <span>개</span>
                  </div>
                </label>

                <label className="wide-field">
                  입금 계좌 메모
                  <input
                    value={account}
                    onChange={(event) => setAccount(event.target.value)}
                    placeholder="은행명 계좌번호"
                  />
                </label>
              </div>
            </article>

            <article className="management-card status-overview-card">
              <div className="management-card-title">
                <span>02</span>
                <div>
                  <h2>현재 진행 상태</h2>
                  <p>실시간으로 계산된 쿠지 현황입니다.</p>
                </div>
              </div>

              <div className="status-overview">
                <div><span>진행률</span><strong>{progress}%</strong></div>
                <div><span>개봉</span><strong>{usedNumbers.length}</strong></div>
                <div><span>남은 번호</span><strong>{remainingCount}</strong></div>
                <div><span>대기 인원</span><strong>{participantQueue.length}</strong></div>
                <div><span>상품 종류</span><strong>{prizes.length}</strong></div>
                <div><span>예상 전체 매출</span><strong>{(price * totalNumbers).toLocaleString()}원</strong></div>
              </div>

              <div className="progress-preview">
                <div>
                  <span>전체 진행률</span>
                  <b>{progress}%</b>
                </div>
                <i><span style={{ width: `${progress}%` }} /></i>
              </div>
            </article>
          </div>
        </section>
      )}

      {isManagePage && activeTab === "prizes" && (
        <section className="management-page">
          <div className="management-page-heading">
            <div>
              <span>PRIZE INVENTORY</span>
              <h1>쿠지별 상품 관리</h1>
              <p>쿠지를 선택한 뒤 해당 쿠지에만 적용되는 보상을 등록하고 수정합니다.</p>
            </div>
          </div>

          <article className="management-card kuji-prize-selector-card">
            <div className="management-card-title">
              <span>KUJI</span>
              <div>
                <h2>보상을 편집할 쿠지 선택</h2>
                <p>쿠지를 바꾸면 상품 목록·수량·자동 배치 결과도 각각 따로 불러옵니다.</p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: "10px",
              }}
            >
              {kujiList
                .slice()
                .sort((a, b) =>
                  a.id === activeKujiId ? -1 : b.id === activeKujiId ? 1 : 0
                )
                .map((kuji) => (
                  <button
                    type="button"
                    key={kuji.id}
                    onClick={() => activateKuji(kuji)}
                    style={{
                      padding: "14px 16px",
                      borderRadius: "12px",
                      border:
                        kuji.id === activeKujiId
                          ? "1px solid #ffd34d"
                          : "1px solid rgba(255,255,255,.12)",
                      background:
                        kuji.id === activeKujiId
                          ? "rgba(255,211,77,.12)"
                          : "rgba(255,255,255,.04)",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: "5px" }}>
                      {kuji.title}
                    </strong>
                    <span style={{ fontSize: "12px", opacity: 0.72 }}>
                      {(Array.isArray(kuji.prizes) ? kuji.prizes.length : 0)}종 ·
                      총 {Number(kuji.totalNumbers) || 0}개
                    </span>
                    {kuji.id === activeKujiId && (
                      <b
                        style={{
                          display: "block",
                          marginTop: "7px",
                          color: "#ffd34d",
                          fontSize: "12px",
                        }}
                      >
                        현재 편집 중
                      </b>
                    )}
                  </button>
                ))}
            </div>

            <div
              style={{
                marginTop: "14px",
                padding: "12px 14px",
                borderRadius: "10px",
                background: "rgba(68,195,255,.08)",
                border: "1px solid rgba(68,195,255,.18)",
              }}
            >
              현재 보상 편집 쿠지: <strong>{roundTitle}</strong>
            </div>
          </article>

          <article className={`management-card auto-assignment-card ${
            isPrizeMapComplete ? "assignment-complete" : ""
          }`}>
            <div className="management-card-title">
              <span>🎲</span>
              <div>
                <h2>자동 상품 배치</h2>
                <p>
                  등록한 상품을 1번부터 {totalNumbers}번까지 무작위로 한 번씩 배치합니다.
                </p>
              </div>
            </div>

            <div className="assignment-status-grid">
              <div>
                <span>전체 번호</span>
                <strong>{totalNumbers}개</strong>
              </div>
              <div>
                <span>상품 전체 수량</span>
                <strong>{currentPrizeTotal}개</strong>
              </div>
              <div>
                <span>상품 남은 수량</span>
                <strong>{currentPrizeRemainingTotal}개</strong>
              </div>
              <div>
                <span>배치된 번호</span>
                <strong>{assignedNumberCount}개</strong>
              </div>
              <div className={isPrizeMapComplete ? "status-ready" : "status-wait"}>
                <span>현재 상태</span>
                <strong>
                  {isPrizeMapComplete
                    ? "추첨 가능"
                    : !isAutoAssignmentQuantityMatched
                      ? "수량 불일치"
                      : "배치 필요"}
                </strong>
              </div>
            </div>

            <div className={`assignment-message ${
              isPrizeMapComplete ? "ready" : "warning"
            }`}>
              {isPrizeMapComplete
                ? "모든 번호에 상품이 고정되었습니다. 선택한 번호에는 항상 같은 상품이 나옵니다."
                : !isAutoAssignmentQuantityMatched
                  ? `번호 ${totalNumbers}개 · 전체 수량 ${currentPrizeTotal}개 · 남은 수량 ${currentPrizeRemainingTotal}개를 모두 동일하게 맞춰 주세요.`
                  : "자동 배치 버튼을 눌러야 라이브 추첨을 시작할 수 있습니다."}
            </div>

            <div className="assignment-actions">
              <button
                type="button"
                className="auto-assign-prize-button"
                onClick={autoAssignPrizes}
              >
                {isPrizeMapComplete
                  ? "🎲 다시 자동 배치"
                  : usedNumbers.length > 0
                    ? "🎲 자동 배치 확인"
                    : !isAutoAssignmentQuantityMatched
                      ? "🎲 수량 확인"
                      : "🎲 자동 상품 배치"}
              </button>
              <button
                type="button"
                className="clear-assignment-button"
                onClick={clearPrizeAssignment}
                disabled={usedNumbers.length > 0 || assignedNumberCount === 0}
              >
                배치 삭제
              </button>
            </div>

            {isPrizeMapComplete && (
              <div className="assignment-hidden-preview">
                <div className="hidden-preview-heading">
                  <strong>배치 완료</strong>
                  <span>상품 위치는 추첨 전까지 가려집니다.</span>
                </div>
                <div className="hidden-number-chips">
                  {allNumbers.slice(0, 18).map((number) => (
                    <span key={number}>
                      <b>{number}</b>
                      <small>LOCKED</small>
                    </span>
                  ))}
                  {totalNumbers > 18 && (
                    <span className="more-chip">
                      <b>+{totalNumbers - 18}</b>
                      <small>MORE</small>
                    </span>
                  )}
                </div>
              </div>
            )}
          </article>

          <article className="management-card add-prize-card">
            <div className="management-card-title">
              <span>+</span>
              <div>
                <h2>새 상품 추가</h2>
                <p>등록 즉시 라이브 상품 재고에 표시됩니다.</p>
              </div>
            </div>

            <div
              style={{
                marginBottom: "16px",
                padding: "14px",
                borderRadius: "14px",
                border: "1px solid rgba(68, 195, 255, 0.24)",
                background: "rgba(6, 17, 30, 0.72)",
              }}
            >
              <strong style={{ display: "block", fontSize: "13px" }}>
                상품 자동 등록
              </strong>
              <span
                style={{
                  display: "block",
                  marginTop: "4px",
                  color: "rgba(148, 163, 184, 0.78)",
                  fontSize: "11px",
                  lineHeight: 1.55,
                }}
              >
                상품명,희귀도,수량 형식으로 한 줄에 하나씩 붙여넣으세요.
                엑셀 3열을 그대로 복사한 탭 형식도 지원합니다.
              </span>

              <textarea
                value={bulkPrizeText}
                onChange={(event) => setBulkPrizeText(event.target.value)}
                placeholder={"메가드림,S,1\n리자몽,A,2\n피카츄,B,5"}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: "150px",
                  marginTop: "12px",
                  padding: "12px",
                  resize: "vertical",
                  borderRadius: "10px",
                  border: "1px solid rgba(112, 132, 165, 0.28)",
                  background: "rgba(2, 8, 18, 0.88)",
                  color: "#f8fafc",
                  font: "inherit",
                  fontSize: "12px",
                  lineHeight: 1.65,
                }}
              />

              <button
                type="button"
                className="primary-action"
                onClick={addBulkManagedPrizes}
                disabled={!bulkPrizeText.trim()}
                style={{ width: "100%", marginTop: "10px" }}
              >
                붙여넣은 상품 한 번에 등록
              </button>
            </div>

            <div className="add-prize-form">
              <label>
                상품명
                <input
                  value={newPrizeName}
                  onChange={(event) => setNewPrizeName(event.target.value)}
                  placeholder="예: 리자몽 PSA10"
                />
              </label>
              <label>
                등급·설명
                <input
                  value={newPrizeGrade}
                  onChange={(event) => setNewPrizeGrade(event.target.value)}
                  placeholder="예: PSA 10"
                />
              </label>
              <label>
                희귀도
                <select
                  value={newPrizeRarity}
                  onChange={(event) => setNewPrizeRarity(event.target.value)}
                >
                  <option value="S">S · 최고 등급</option>
                  <option value="A">A · 상급</option>
                  <option value="B">B · 일반</option>
                  <option value="C">C · 기본</option>
                </select>
              </label>
              <label>
                수량
                <input
                  type="number"
                  min="1"
                  value={newPrizeQuantity}
                  onChange={(event) =>
                    setNewPrizeQuantity(
                      Math.max(1, Number(event.target.value) || 1),
                    )
                  }
                />
              </label>

              <label>
                상품 이미지
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleNewPrizeImageChange}
                />
              </label>

              <div
                style={{
                  minHeight: "140px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px",
                  borderRadius: "12px",
                  border: "1px solid rgba(112, 132, 165, 0.18)",
                  background: "rgba(5, 12, 23, 0.5)",
                }}
              >
                <div
                  style={{
                    width:"110px",
                    height:"110px",
                    flexShrink: 0,
                    overflow: "hidden",
                    borderRadius: "10px",
                    border: "1px solid rgba(68, 195, 255, 0.35)",
                    background: "rgba(11, 25, 40, 0.9)",
                  }}
                >
                  {newPrizeImage ? (
                    <img
                      src={newPrizeImage}
                      alt="새 상품 미리보기"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        color: "rgba(148, 163, 184, 0.5)",
                        fontSize: "11px",
                        fontWeight: 800,
                      }}
                    >
                      이미지
                    </div>
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: "12px" }}>
                    이미지 미리보기
                  </strong>
                  <span
                    style={{
                      display: "block",
                      marginTop: "4px",
                      color: "rgba(148, 163, 184, 0.7)",
                      fontSize: "11px",
                    }}
                  >
                    JPG·PNG·WEBP / 최대 2MB
                  </span>

                  {newPrizeImage && (
                    <button
                      type="button"
                      onClick={() => { setNewPrizeImage(""); setNewPrizeImageFile(null); }}
                      style={{
                        marginTop: "8px",
                        minHeight: "30px",
                        padding: "0 10px",
                        borderRadius: "8px",
                        fontSize: "11px",
                        fontWeight: 800,
                      }}
                    >
                      이미지 삭제
                    </button>
                  )}
                </div>
              </div>

              <button
                type="button"
                className="primary-action"
                onClick={addManagedPrize}
              >
                상품 추가
              </button>
            </div>
          </article>

          <div
            className="managed-prize-list"
            style={{
              width: "100%",
              minWidth: 0,
              overflowX: "auto",
              paddingBottom: "4px",
            }}
          >
            {prizes.map((prize, index) => (
              <article
                className="managed-prize-card"
                key={prize.id}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "86px 112px minmax(420px, 1fr) minmax(190px, 220px) 58px",
                  alignItems: "center",
                  columnGap: "16px",
                  rowGap: "12px",
                  width: "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
                  overflow: "hidden",
                  border: prize.featured ? "1px solid rgba(255, 74, 91, 0.75)" : undefined,
                  background: prize.featured ? "linear-gradient(135deg, rgba(62, 13, 24, 0.56), rgba(13, 20, 34, 0.98))" : undefined,
                  boxShadow: prize.featured ? "0 0 0 1px rgba(255, 74, 91, 0.08), 0 12px 32px rgba(120, 10, 28, 0.18)" : undefined,
                }}
              >
                <div
                  style={{
                    width: "86px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "7px",
                  }}
                >
                  <div
                    className={`managed-prize-index accent-${getPrizeAccent(
                      prize,
                      index,
                    )}`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "5px",
                      width: "100%",
                    }}
                  >
                    <button
                      type="button"
                      title="위로 이동 · 라이브 화면에서 먼저 노출"
                      aria-label={`${prize.name} 상품 위로 이동`}
                      onClick={() => moveManagedPrize(prize.id, "up")}
                      disabled={index === 0}
                      style={{
                        minWidth: 0,
                        height: "30px",
                        padding: 0,
                        borderRadius: "8px",
                        border: "1px solid rgba(68, 195, 255, 0.28)",
                        background:
                          index === 0
                            ? "rgba(18, 27, 44, 0.48)"
                            : "rgba(68, 195, 255, 0.1)",
                        color:
                          index === 0
                            ? "rgba(148, 163, 184, 0.35)"
                            : "rgba(125, 220, 255, 0.95)",
                        fontSize: "15px",
                        fontWeight: 900,
                        cursor: index === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      title="아래로 이동"
                      aria-label={`${prize.name} 상품 아래로 이동`}
                      onClick={() => moveManagedPrize(prize.id, "down")}
                      disabled={index === prizes.length - 1}
                      style={{
                        minWidth: 0,
                        height: "30px",
                        padding: 0,
                        borderRadius: "8px",
                        border: "1px solid rgba(112, 132, 165, 0.2)",
                        background:
                          index === prizes.length - 1
                            ? "rgba(18, 27, 44, 0.48)"
                            : "rgba(112, 132, 165, 0.1)",
                        color:
                          index === prizes.length - 1
                            ? "rgba(148, 163, 184, 0.35)"
                            : "rgba(203, 213, 225, 0.9)",
                        fontSize: "15px",
                        fontWeight: 900,
                        cursor:
                          index === prizes.length - 1
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      ↓
                    </button>
                  </div>

                  <span
                    style={{
                      color: "rgba(148, 163, 184, 0.58)",
                      fontSize: "9px",
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    노출 순서
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      updateManagedPrize(prize.id, "featured", !prize.featured);
                      setNotice(prize.featured
                        ? `${prize.name} 상품의 좋은 상품 표시를 해제했습니다.`
                        : `${prize.name} 상품을 좋은 상품으로 표시했습니다.`);
                    }}
                    style={{
                      width: "100%", minHeight: "32px", padding: "0 8px",
                      borderRadius: "8px",
                      border: prize.featured ? "1px solid rgba(255, 76, 94, 0.9)" : "1px solid rgba(112, 132, 165, 0.22)",
                      background: prize.featured ? "linear-gradient(180deg, rgba(180, 32, 53, 0.96), rgba(116, 17, 35, 0.96))" : "rgba(19, 28, 45, 0.78)",
                      color: prize.featured ? "#ffffff" : "rgba(203, 213, 225, 0.8)",
                      fontSize: "10px", fontWeight: 900, cursor: "pointer",
                      boxShadow: prize.featured ? "0 6px 16px rgba(180, 22, 48, 0.28)" : "none",
                    }}
                  >
                    {prize.featured ? "★ 좋은 상품" : "☆ 좋은 상품 표시"}
                  </button>
                </div>

                <div
                  style={{
                    width: "112px",
                    flex: "0 0 112px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div
                    style={{
                      width: "112px",
                      height: "125px",
                      overflow: "hidden",
                      borderRadius: "11px",
                      border: "1px solid rgba(68, 195, 255, 0.3)",
                      background: "rgba(6, 16, 28, 0.85)",
                    }}
                  >
                    {prize.image ? (
                      <img
                        src={prize.image}
                        alt={prize.name}
                        style={{
                          display: "block",
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height: "100%",
                          display: "grid",
                          placeItems: "center",
                          color: "rgba(148, 163, 184, 0.5)",
                          fontSize: "11px",
                          fontWeight: 800,
                        }}
                      >
                        이미지 없음
                      </div>
                    )}
                  </div>

                  <label
                    style={{
                      minHeight: "32px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0 10px",
                      borderRadius: "8px",
                      border: "1px solid rgba(68, 195, 255, 0.25)",
                      background: "rgba(68, 195, 255, 0.08)",
                      color: "rgba(220, 240, 255, 0.92)",
                      fontSize: "11px",
                      fontWeight: 850,
                      cursor: "pointer",
                    }}
                  >
                    이미지 {prize.image ? "변경" : "등록"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        handleManagedPrizeImageChange(prize.id, event)
                      }
                      style={{ display: "none" }}
                    />
                  </label>

                  {prize.image && (
                    <button
                      type="button"
                      onClick={() => {
                        updateManagedPrize(prize.id, "image", "");
                        setNotice("상품 이미지를 삭제했습니다.");
                      }}
                      style={{
                        minHeight: "30px",
                        borderRadius: "8px",
                        fontSize: "11px",
                        fontWeight: 800,
                      }}
                    >
                      이미지 삭제
                    </button>
                  )}
                </div>

                <div
                  className="managed-prize-fields"
                  style={{
                    minWidth: 0,
                    width: "100%",
                    display: "grid",
                    gridTemplateColumns:
                      "minmax(160px, 1.3fr) minmax(160px, 1fr) 120px 92px 92px",
                    alignItems: "end",
                    gap: "10px",
                  }}
                >
                  <label>
                    상품명
                    <input
                      value={prize.name}
                      onChange={(event) =>
                        updateManagedPrize(prize.id, "name", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    등급·설명
                    <input
                      value={prize.grade}
                      onChange={(event) =>
                        updateManagedPrize(prize.id, "grade", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    희귀도
                    <select
                      value={getPrizeRarity(prize).rarity}
                      onChange={(event) =>
                        updateManagedPrize(prize.id, "rarity", event.target.value)
                      }
                    >
                      <option value="S">S · 최고 등급</option>
                      <option value="A">A · 상급</option>
                      <option value="B">B · 일반</option>
                      <option value="C">C · 기본</option>
                    </select>
                  </label>
                  <label>
                    전체
                    <input
                      type="number"
                      min="0"
                      value={prize.total}
                      onChange={(event) =>
                        updateManagedPrize(prize.id, "total", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    남은 수량
                    <input
                      type="number"
                      min="0"
                      max={prize.total}
                      value={prize.remaining}
                      onChange={(event) =>
                        updateManagedPrize(prize.id, "remaining", event.target.value)
                      }
                    />
                  </label>
                </div>

                <div
                  className="managed-prize-stock"
                  style={{
                    width: "100%",
                    minWidth: 0,
                    boxSizing: "border-box",
                  }}
                >
                  <span>재고</span>
                  <strong>{prize.remaining}/{prize.total}</strong>
                  <i>
                    <span
                      style={{
                        width: `${prize.total > 0 ? (prize.remaining / prize.total) * 100 : 0}%`,
                      }}
                    />
                  </i>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginTop: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => changePrizeRemaining(prize.id, -1)}
                      disabled={prize.remaining <= 0}
                      style={{
                        minWidth: "38px",
                        height: "34px",
                        borderRadius: "9px",
                        fontWeight: 900,
                      }}
                    >
                      −
                    </button>

                    <button
                      type="button"
                      onClick={() => changePrizeRemaining(prize.id, 1)}
                      disabled={prize.remaining >= prize.total}
                      style={{
                        minWidth: "38px",
                        height: "34px",
                        borderRadius: "9px",
                        fontWeight: 900,
                      }}
                    >
                      +
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updateManagedPrize(prize.id, "remaining", prize.total)
                      }
                      disabled={prize.remaining >= prize.total}
                      style={{
                        height: "34px",
                        padding: "0 12px",
                        borderRadius: "9px",
                        fontWeight: 800,
                      }}
                    >
                      전체 채우기
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="managed-prize-delete"
                  onClick={() => deleteManagedPrize(prize.id)}
                  style={{
                    position: "static",
                    alignSelf: "center",
                    justifySelf: "center",
                    margin: 0,
                  }}
                >
                  삭제
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {isManagePage && activeTab === "records" && (
        <section className="management-page">
          <div className="management-page-heading">
            <div>
              <span>DRAW ARCHIVE</span>
              <h1>쿠지별 진행 기록</h1>
              <p>쿠지를 선택해서 해당 쿠지의 참가자, 번호와 상품만 확인합니다.</p>
            </div>
            <button
              type="button"
              className="danger-outline"
              onClick={clearRecordViewHistory}
            >
              선택 쿠지 기록 삭제
            </button>
          </div>

          <article className="management-card record-kuji-selector-card">
            <div className="management-card-title">
              <span>📂</span>
              <div>
                <h2>기록을 볼 쿠지 선택</h2>
                <p>라이브 중인 쿠지는 바꾸지 않고 기록 화면만 전환됩니다.</p>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                gap: "10px",
              }}
            >
              {kujiList.map((kuji) => {
                const savedHistory =
                  kuji.id === activeKujiId
                    ? history
                    : Array.isArray(kuji.history)
                      ? kuji.history
                      : [];
                const savedDrawCount = savedHistory.reduce(
                  (sum, entry) =>
                    sum +
                    (Array.isArray(entry.results)
                      ? entry.results.length
                      : Array.isArray(entry.numbers)
                        ? entry.numbers.length
                        : Number(entry.quantity) || 0),
                  0,
                );

                return (
                  <button
                    type="button"
                    key={kuji.id}
                    onClick={() => setRecordViewKujiId(kuji.id)}
                    style={{
                      padding: "14px 16px",
                      borderRadius: "12px",
                      border:
                        kuji.id === recordViewKujiId
                          ? "1px solid #ffd34d"
                          : "1px solid rgba(255,255,255,.12)",
                      background:
                        kuji.id === recordViewKujiId
                          ? "rgba(255,211,77,.12)"
                          : "rgba(255,255,255,.04)",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <strong style={{ display: "block", marginBottom: "5px" }}>
                      {kuji.title}
                    </strong>
                    <span style={{ fontSize: "12px", opacity: 0.72 }}>
                      기록 {savedHistory.length}건 · 총 {savedDrawCount}회
                    </span>
                    {kuji.id === activeKujiId && (
                      <b
                        style={{
                          display: "block",
                          marginTop: "7px",
                          color: "#53d7ff",
                          fontSize: "12px",
                        }}
                      >
                        현재 진행 중
                      </b>
                    )}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: "14px",
                padding: "12px 14px",
                borderRadius: "10px",
                background: "rgba(68,195,255,.08)",
                border: "1px solid rgba(68,195,255,.18)",
              }}
            >
              현재 보고 있는 기록: <strong>{recordViewTitle}</strong>
            </div>
          </article>

          <article className="management-card participant-summary-card">
            <div className="management-card-title">
              <span>👥</span>
              <div>
                <h2>참가자별 뽑은 횟수</h2>
                <p>{recordViewTitle}에서 각 참가자가 뽑은 총 횟수를 자동으로 합산합니다.</p>
              </div>
            </div>

            {participantDrawStats.length === 0 ? (
              <div className="records-empty">
                <strong>아직 참가자 집계가 없습니다.</strong>
                <p>추첨을 진행하면 닉네임별 뽑은 횟수가 여기에 표시됩니다.</p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "10px",
                    marginBottom: "14px",
                  }}
                >
                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "12px",
                      background: "rgba(255,255,255,.05)",
                      border: "1px solid rgba(255,255,255,.1)",
                    }}
                  >
                    <span style={{ display: "block", opacity: 0.7, fontSize: "12px" }}>
                      참가자 수
                    </span>
                    <strong style={{ fontSize:"34px" }}>
                      {participantDrawStats.length}명
                    </strong>
                  </div>

                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "12px",
                      background: "rgba(255,211,77,.08)",
                      border: "1px solid rgba(255,211,77,.18)",
                    }}
                  >
                    <span style={{ display: "block", opacity: 0.7, fontSize: "12px" }}>
                      총 뽑은 횟수
                    </span>
                    <strong style={{ fontSize:"34px", color: "#ffd34d" }}>
                      {totalParticipantDrawCount}회
                    </strong>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  {participantDrawStats.map((participant, index) => (
                    <div
                      key={participant.nickname}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "52px minmax(120px, 1fr) 110px 110px",
                        alignItems: "center",
                        gap: "10px",
                        padding: "12px 14px",
                        borderRadius: "11px",
                        background:
                          index === 0
                            ? "rgba(255,211,77,.09)"
                            : "rgba(255,255,255,.035)",
                        border:
                          index === 0
                            ? "1px solid rgba(255,211,77,.2)"
                            : "1px solid rgba(255,255,255,.08)",
                      }}
                    >
                      <b style={{ color: index === 0 ? "#ffd34d" : "inherit" }}>
                        {index + 1}위
                      </b>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRecordNickname(participant.nickname)
                        }
                        title={`${participant.nickname}님의 상세 기록 보기`}
                        style={{
                          justifySelf: "start",
                          maxWidth: "100%",
                          padding: "5px 8px",
                          borderRadius: "8px",
                          border: "1px solid rgba(68,195,255,.22)",
                          background: "rgba(68,195,255,.07)",
                          color: "#eaf8ff",
                          fontSize: "14px",
                          fontWeight: 900,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}
                      >
                        {participant.nickname}
                      </button>
                      <span>
                        <b style={{ fontSize:"30px" }}>{participant.drawCount}</b>회 뽑음
                      </span>
                      <span style={{ opacity: 0.72, fontSize: "20px" }}>
                        참여 {participant.participationCount}번
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>

          <article className="management-card records-card">
            {recordViewHistory.length === 0 ? (
              <div className="records-empty">
                <span>☷</span>
                <strong>아직 진행 기록이 없습니다.</strong>
                <p>라이브 추첨을 진행하면 이곳에 자동으로 저장됩니다.</p>
              </div>
            ) : (
              <div className="records-table">
                <div className="records-table-head">
                  <span>순서</span>
                  <span>참가자</span>
                  <span>번호</span>
                  <span>당첨 상품</span>
                  <span>진행 시각</span>
                </div>
                {recordViewHistory.flatMap((entry, entryIndex) =>
                  (entry.results || []).map((result, resultIndex) => (
                    <div
                      className="records-table-row"
                      key={`${entry.id}-${result.number}-${resultIndex}`}
                    >
                      <span>{recordViewHistory.length - entryIndex}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRecordNickname(
                            String(entry.nickname || "이름 없음").trim() ||
                              "이름 없음",
                          )
                        }
                        title={`${entry.nickname}님의 상세 기록 보기`}
                        style={{
                          justifySelf: "start",
                          maxWidth: "100%",
                          padding: "4px 7px",
                          border: 0,
                          borderRadius: "7px",
                          background: "rgba(68,195,255,.07)",
                          color: "#eaf8ff",
                          fontWeight: 900,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          cursor: "pointer",
                        }}
                      >
                        {entry.nickname}
                      </button>
                      <b>{result.number}번</b>
                      <span>{result.prizeName}<small>{result.grade}</small></span>
                      <time>{entry.createdAt}</time>
                    </div>
                  )),
                )}
              </div>
            )}
          </article>
        </section>
      )}


      {selectedParticipantRecord && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedRecordNickname("");
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "grid",
            placeItems: "center",
            padding: "24px",
            background: "rgba(1, 6, 15, 0.78)",
            backdropFilter: "blur(8px)",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedParticipantRecord.nickname}님의 참여 상세 기록`}
            style={{
              width: "min(860px, 96vw)",
              maxHeight: "88vh",
              overflow: "hidden",
              borderRadius: "20px",
              border: "1px solid rgba(68,195,255,.3)",
              background:
                "linear-gradient(180deg, rgba(15,25,43,.99), rgba(7,14,26,.99))",
              boxShadow: "0 28px 80px rgba(0,0,0,.55)",
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "18px",
                padding: "20px 22px",
                borderBottom: "1px solid rgba(255,255,255,.09)",
              }}
            >
              <div>
                <span
                  style={{
                    color: "#44c3ff",
                    fontSize: "11px",
                    fontWeight: 900,
                    letterSpacing: ".12em",
                  }}
                >
                  PARTICIPANT RECORD
                </span>
                <h2 style={{ margin: "6px 0 4px" }}>
                  {selectedParticipantRecord.nickname}님 상세 기록
                </h2>
                <p style={{ margin: 0, opacity: 0.68, fontSize: "20px" }}>
                  {recordViewTitle}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedRecordNickname("")}
                style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "11px",
                  border: "1px solid rgba(255,255,255,.12)",
                  background: "rgba(255,255,255,.05)",
                  color: "#fff",
                  fontSize:"32px",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </header>

            <div
              style={{
                maxHeight: "calc(88vh - 92px)",
                overflowY: "auto",
                padding: "20px 22px 24px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "10px",
                  marginBottom: "18px",
                }}
              >
                {[
                  ["참여 횟수", `${selectedParticipantRecord.participationCount}회`],
                  ["총 뽑은 수", `${selectedParticipantRecord.drawCount}개`],
                  ["최근 참여", selectedParticipantRecord.latestAt],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{
                      minWidth: 0,
                      padding: "14px",
                      borderRadius: "13px",
                      border: "1px solid rgba(255,255,255,.09)",
                      background: "rgba(255,255,255,.045)",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        marginBottom: "6px",
                        opacity: 0.62,
                        fontSize: "11px",
                        fontWeight: 800,
                      }}
                    >
                      {label}
                    </span>
                    <strong
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: label === "최근 참여" ? "12px" : "21px",
                        color: label === "총 뽑은 수" ? "#ffd34d" : "#fff",
                      }}
                    >
                      {value}
                    </strong>
                  </div>
                ))}
              </div>

              <div
                style={{
                  marginBottom: "18px",
                  padding: "16px",
                  borderRadius: "14px",
                  border: "1px solid rgba(255,211,77,.16)",
                  background: "rgba(255,211,77,.055)",
                }}
              >
                <h3 style={{ margin: "0 0 12px", fontSize: "14px" }}>
                  획득 상품 요약
                </h3>

                <div style={{ display: "grid", gap: "8px" }}>
                  {selectedParticipantRecord.prizeCounts.map((prize) => (
                    <div
                      key={`${prize.name}-${prize.grade}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1fr) auto",
                        alignItems: "center",
                        gap: "12px",
                        padding: "10px 12px",
                        borderRadius: "10px",
                        background: "rgba(0,0,0,.16)",
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <strong
                          style={{
                            display: "block",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {prize.name}
                        </strong>
                        {prize.grade && (
                          <small
                            style={{
                              display: "block",
                              marginTop: "3px",
                              opacity: 0.6,
                            }}
                          >
                            {prize.grade}
                          </small>
                        )}
                      </span>
                      <b style={{ color: "#ffd34d", fontSize: "17px" }}>
                        {prize.count}개
                      </b>
                    </div>
                  ))}
                </div>
              </div>

              <h3 style={{ margin: "0 0 10px", fontSize: "14px" }}>
                참여별 상세 내역
              </h3>

              <div style={{ display: "grid", gap: "10px" }}>
                {selectedParticipantRecord.participations.map(
                  (participation, participationIndex) => (
                    <article
                      key={participation.id}
                      style={{
                        padding: "14px",
                        borderRadius: "13px",
                        border: "1px solid rgba(255,255,255,.09)",
                        background: "rgba(255,255,255,.035)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                          marginBottom: "11px",
                        }}
                      >
                        <strong>
                          {selectedParticipantRecord.participations.length -
                            participationIndex}
                          회차
                        </strong>
                        <time style={{ opacity: 0.62, fontSize: "12px" }}>
                          {participation.createdAt}
                        </time>
                      </div>

                      <div style={{ display: "grid", gap: "7px" }}>
                        {participation.results.map((result, resultIndex) => (
                          <div
                            key={`${participation.id}-${result.number}-${resultIndex}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "72px minmax(0,1fr)",
                              alignItems: "center",
                              gap: "10px",
                              padding: "9px 11px",
                              borderRadius: "9px",
                              background: "rgba(4,12,23,.6)",
                            }}
                          >
                            <b style={{ color: "#44c3ff" }}>
                              {result.number}번
                            </b>
                            <span style={{ minWidth: 0 }}>
                              <strong
                                style={{
                                  display: "block",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {result.prizeName}
                              </strong>
                              {result.grade && (
                                <small
                                  style={{
                                    display: "block",
                                    marginTop: "2px",
                                    opacity: 0.58,
                                  }}
                                >
                                  {result.grade}
                                </small>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ),
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {pendingNumbers.length > 0 && (
        <div className="appraisal-backdrop">
          <section
            className="appraisal-modal reveal-modal"
            style={{
              width: "min(1180px, calc(100vw - 40px))",
              maxWidth: "1180px",
            }}
          >
            <div className="appraisal-header">
              <div>
                <span className="appraisal-label">AI REVEAL SYSTEM</span>
                <h2>{pendingPlayer}님의 상품 분석</h2>
                <p>
                  {pendingMode} ·{" "}
                  {revealMode === "simultaneous"
                    ? `${pendingNumbers.length}개 동시 진행`
                    : `${activeRevealIndex + 1}/${pendingNumbers.length}`}
                </p>
              </div>

              {!isAppraising && (
                <button type="button" className="appraisal-close" onClick={cancelAppraisal}>✕</button>
              )}
            </div>

            <div className="ai-reveal-stage">
              <div className="ai-grid" />

              {highRarityAlert && (
                <div className="high-rarity-overlay" role="status" aria-live="assertive">
                  <div className="high-rarity-flash" />
                  <div className="high-rarity-ring ring-one" />
                  <div className="high-rarity-ring ring-two" />
                  <div className="high-rarity-content">
                    <span>⚠ HIGH RARITY DETECTED</span>
                    <strong>S</strong>
                    <p>S등급 상품이 포함되어 있습니다</p>
                  </div>
                </div>
              )}
              {revealMode === "simultaneous" ? (
                <div
                  ref={simultaneousScrollRef}
                  className={`ai-core simultaneous-core step-${revealStep} ${isAppraising ? "scanning" : ""}`}
                  style={{
                    position: "relative",
                    inset: "auto",
                    top: 0,
                    left: 0,
                    right: "auto",
                    bottom: "auto",
                    transform: "none",
                    width: "100%",
                    height: "100%",
                    maxHeight: "100%",
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    alignItems: "stretch",
                    alignContent: "start",
                    justifyContent: "flex-start",
                    paddingTop: revealStep >= 2 ? "20px" : 0,
                    paddingBottom: revealStep >= 2 ? "24px" : 0,
                    scrollPaddingTop: "20px",
                    overscrollBehavior: "contain",
                    boxSizing: "border-box",
                  }}
                >
                  {revealStep === 0 && (
                    <div className="reveal-panel intro-panel simultaneous-intro">
                      <span className="panel-kicker">RESULT LOCKED</span>
                      <h3>결과가 확정되었습니다</h3>
                      <p>{lockedResults.length}개의 상품을 한 번에 분석합니다.</p>
                    </div>
                  )}

                  {revealStep === 1 && (
                    <div
                      className="reveal-panel scan-panel simultaneous-intro"
                      style={{
                        width: "min(760px, calc(100% - 40px))",
                        padding: "28px 34px 32px",
                        border: "1px solid rgba(72, 190, 255, 0.32)",
                        borderRadius: "22px",
                        background:
                          "linear-gradient(180deg, rgba(5,20,34,.96), rgba(3,13,24,.98))",
                        boxShadow:
                          "0 0 45px rgba(31,165,255,.12), inset 0 0 32px rgba(29,151,224,.05)",
                      }}
                    >
                      <div className="scanner-orb"><span /></div>
                      <span className="panel-kicker">
                        {analysisPhase === "value"
                          ? "VALUE SCANNING"
                          : analysisPhase === "rarity"
                            ? "RARITY DECODING"
                            : "AI BATCH ANALYZING"}
                      </span>
                      <h3 style={{ marginBottom: "24px" }}>
                        {analysisPhase === "value"
                          ? "가치 분석 중"
                          : analysisPhase === "rarity"
                            ? "희귀도 분석 중"
                            : "분석 결과 확인 중"}
                      </h3>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "16px",
                          width: "100%",
                        }}
                      >
                        <div
                          style={{
                            position: "relative",
                            overflow: "hidden",
                            minHeight: "116px",
                            padding: "18px 20px",
                            borderRadius: "15px",
                            border:
                              analysisPhase === "value"
                                ? "1px solid rgba(255,211,77,.78)"
                                : "1px solid rgba(62,139,190,.34)",
                            background:
                              analysisPhase === "value"
                                ? "radial-gradient(circle at 50% 50%, rgba(255,204,60,.13), rgba(5,20,33,.92) 68%)"
                                : "rgba(5,20,33,.78)",
                            boxShadow:
                              analysisPhase === "value"
                                ? "0 0 26px rgba(255,196,45,.17), inset 0 0 22px rgba(255,208,66,.07)"
                                : "none",
                            transition: "all 220ms ease",
                          }}
                        >
                          {analysisPhase === "value" && (
                            <span
                              style={{
                                position: "absolute",
                                inset: "0 auto 0 -35%",
                                width: "34%",
                                background:
                                  "linear-gradient(90deg, transparent, rgba(255,226,126,.18), transparent)",
                                animation: "valueScanSweep 900ms linear infinite",
                                transform: "skewX(-16deg)",
                              }}
                            />
                          )}
                          <span
                            style={{
                              display: "block",
                              marginBottom: "12px",
                              color: "rgba(151,190,214,.78)",
                              fontSize: "11px",
                              fontWeight: 900,
                              letterSpacing: ".14em",
                            }}
                          >
                            가치
                          </span>
                          <strong
                            key={`stars-${displayStars}`}
                            style={{
                              position: "relative",
                              display: "block",
                              color: "#ffd34d",
                              fontSize: "34px",
                              lineHeight: 1,
                              letterSpacing: "4px",
                              textShadow: "0 0 18px rgba(255,204,61,.44)",
                              animation:
                                analysisPhase === "value"
                                  ? "analysisValuePop 230ms ease-out"
                                  : "none",
                            }}
                          >
                            {"★".repeat(displayStars)}
                            {"☆".repeat(5 - displayStars)}
                          </strong>
                          <small
                            style={{
                              display: "block",
                              marginTop: "13px",
                              color:
                                analysisPhase === "value"
                                  ? "rgba(255,223,119,.9)"
                                  : "rgba(123,158,181,.6)",
                              fontWeight: 800,
                            }}
                          >
                            {analysisPhase === "value"
                              ? "측정값 변동 중..."
                              : analysisPhase === "rarity" ||
                                  analysisPhase === "complete"
                                ? "가치 분석 완료"
                                : "대기 중"}
                          </small>
                        </div>

                        <div
                          style={{
                            position: "relative",
                            overflow: "hidden",
                            minHeight: "116px",
                            padding: "18px 20px",
                            borderRadius: "15px",
                            border:
                              analysisPhase === "rarity"
                                ? "1px solid rgba(76,205,255,.82)"
                                : "1px solid rgba(62,139,190,.34)",
                            background:
                              analysisPhase === "rarity"
                                ? "radial-gradient(circle at 50% 50%, rgba(53,183,255,.14), rgba(5,20,33,.92) 68%)"
                                : "rgba(5,20,33,.78)",
                            boxShadow:
                              analysisPhase === "rarity"
                                ? "0 0 28px rgba(42,179,255,.2), inset 0 0 24px rgba(62,196,255,.08)"
                                : "none",
                            transition: "all 220ms ease",
                          }}
                        >
                          {analysisPhase === "rarity" && (
                            <span
                              style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                top: "12%",
                                height: "2px",
                                background:
                                  "linear-gradient(90deg, transparent, #5cd8ff, transparent)",
                                boxShadow: "0 0 14px #5cd8ff",
                                animation: "rarityScanLine 950ms ease-in-out infinite",
                              }}
                            />
                          )}
                          <span
                            style={{
                              display: "block",
                              marginBottom: "7px",
                              color: "rgba(151,190,214,.78)",
                              fontSize: "11px",
                              fontWeight: 900,
                              letterSpacing: ".14em",
                            }}
                          >
                            희귀도
                          </span>
                          <strong
                            key={`rarity-${displayRarity}`}
                            style={{
                              position: "relative",
                              display: "block",
                              color:
                                displayRarity === "S"
                                  ? "#ffd34d"
                                  : displayRarity === "A"
                                    ? "#a98cff"
                                    : displayRarity === "B"
                                      ? "#62d8ff"
                                      : "#9eb5c5",
                              fontSize: "54px",
                              lineHeight: 1,
                              fontWeight: 1000,
                              textShadow:
                                analysisPhase === "rarity"
                                  ? "0 0 24px currentColor"
                                  : "none",
                              animation:
                                analysisPhase === "rarity"
                                  ? "analysisRarityFlip 220ms ease-out"
                                  : "none",
                            }}
                          >
                            {analysisPhase === "value" ? "LOCKED" : displayRarity}
                          </strong>
                          <small
                            style={{
                              display: "block",
                              marginTop: "8px",
                              color:
                                analysisPhase === "rarity"
                                  ? "rgba(126,220,255,.94)"
                                  : "rgba(123,158,181,.6)",
                              fontWeight: 800,
                            }}
                          >
                            {analysisPhase === "value"
                              ? "가치 분석 후 진행"
                              : analysisPhase === "rarity"
                                ? "등급 데이터 해독 중..."
                                : analysisPhase === "complete"
                                  ? "희귀도 분석 완료"
                                  : "대기 중"}
                          </small>
                        </div>
                      </div>

                      <div className="analysis-lines" style={{ marginTop: "24px" }}>
                        <i /><i /><i />
                      </div>
                    </div>
                  )}

                  {revealStep >= 2 && (
                    <div
                      className="simultaneous-result-grid"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))",
                        gap: "18px",
                        width: "100%",
                        maxWidth: "1040px",
                        margin: "0 auto",
                        paddingTop: 0,
                        alignSelf: "start",
                        justifySelf: "stretch",
                        flex: "0 0 auto",
                        position: "relative",
                        top: 0,
                        transform: "none",
                        boxSizing: "border-box",
                      }}
                    >
                      {lockedResults.map((result, index) => (
                        <article
                          className={
                            revealStep >= 4
                              ? `batch-result-card rarity-border-${result.rarity}`
                              : "batch-result-card"
                          }
                          key={`${result.number}-${index}`}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            maxWidth: "none",
                            boxSizing: "border-box",
                            overflow: "visible",
                          }}
                        >
                          <div className="batch-number">
                            <span>NUMBER</span>
                            <strong>{revealStep >= 4 ? result.number : "?"}</strong>
                          </div>

                          <div
                            className={`batch-result-line ${
                              revealStep >= 4 ? "visible" : "locked"
                            }`}
                          >
                            <span>희귀도</span>
                            <b
                              className={
                                revealStep >= 4
                                  ? `rarity rarity-${result.rarity}`
                                  : ""
                              }
                            >
                              {revealStep >= 4 ? result.rarity : "비공개"}
                            </b>
                          </div>

                          <div
                            className={`batch-result-line batch-stars ${
                              revealStep >= 4 ? "visible" : "locked"
                            }`}
                          >
                            <span>가치</span>
                            <b>
                              {revealStep >= 4
                                ? "★".repeat(result.stars) +
                                  "☆".repeat(5 - result.stars)
                                : "비공개"}
                            </b>
                          </div>

                          <div
                            className={`batch-product ${
                              revealStep >= 4 ? "visible" : "locked"
                            }`}
                            style={{
                              position: "relative",
                              overflow: "hidden",
                              gridColumn: "1 / -1",
                              justifySelf: "stretch",
                              width: "100%",
                              minWidth: 0,
                              maxWidth: "none",
                              height: "215px",
                              minHeight: "215px",
                              maxHeight: "215px",
                              margin: "30px 0 0",
                              padding: "16px 18px",
                              boxSizing: "border-box",
                            }}
                          >
                            <span>FINAL PRODUCT</span>
                            {revealStep >= 4 && (
                              <div
                                style={{
                                  display:"grid",
                                  gridTemplateColumns:"120px minmax(0, 1fr)",
                                  gap:"24px",
                                  alignItems:"center",
                                  width:"100%",
                                  minWidth:0,
                                  marginTop:"8px",
                                }}
                              >
                                <div style={{
                                  width:"120px",height:"120px",
                                  overflow:"hidden",
                                  borderRadius:"12px",
                                  background:"#0a121c"
                                }}>
                                  {result.image && (
                                    <img
                                      src={result.image}
                                      alt={result.prizeName}
                                      style={{width:"100%",height:"100%",objectFit:"contain"}}
                                    />
                                  )}
                                </div>
                                <div style={{textAlign:"left",minWidth:0,overflow:"hidden",transform:"translate(3px, 3px)"}}>
                                  <h3 style={{
                                    fontSize:"42px",
                                    margin:"0 0 12px",
                                    fontWeight:900,
                                    overflow:"hidden",
                                    textOverflow:"ellipsis",
                                    whiteSpace:"nowrap"
                                  }}>
                                    {result.prizeName}
                                  </h3>
                                  <p style={{fontSize:"23px",lineHeight:1,margin:0,fontWeight:800}}>
                                    {result.grade}
                                  </p>
                                </div>
                              </div>
                            )}

                            {revealStep >= 4 &&
                              !openedProductIndexes.includes(index) && (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  aria-label="드래그해서 최종 상품 공개"
                                  onPointerDown={(event) =>
                                    handleProductPointerDown(event, index)
                                  }
                                  onPointerMove={(event) =>
                                    handleProductPointerMove(event, index)
                                  }
                                  onPointerUp={(event) =>
                                    finishProductDrag(event, index)
                                  }
                                  onPointerCancel={(event) =>
                                    finishProductDrag(event, index)
                                  }
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    zIndex: 20,
                                    display: "grid",
                                    placeItems: "center",
                                    padding: "14px",
                                    borderRadius: "inherit",
                                    border:
                                      "1px solid rgba(255, 211, 77, 0.38)",
                                    background: "#07101d",
                                    boxShadow:
                                      "inset 0 1px 0 rgba(255,255,255,.08)",
                                    opacity: 1,
                                    backgroundColor: "#07101d",
                                    backgroundImage: "none",
                                    backdropFilter: "none",
                                    transform: `translateX(${
                                      productDragOffsets[index]?.x || 0
                                    }px)`,
                                    transition:
                                      draggingProductIndex === index
                                        ? "none"
                                        : "transform 220ms ease",
                                    touchAction: "none",
                                    pointerEvents: "auto",
                                    cursor:
                                      draggingProductIndex === index
                                        ? "grabbing"
                                        : "grab",
                                    userSelect: "none",
                                  }}
                                >
                                  <div style={{ textAlign: "center" }}>
                                    <strong
                                      style={{
                                        display: "block",
                                        color: "#ffd34d",
                                        fontSize: "20px",
                                      }}
                                    >
                                      FINAL PRODUCT
                                    </strong>
                                    <span
                                      style={{
                                        display: "block",
                                        marginTop: "7px",
                                        color: "rgba(226,232,240,.74)",
                                        fontSize: "11px",
                                      }}
                                    >
                                      마우스로 잡고 밀어서 공개
                                    </span>
                                  </div>
                                </div>
                              )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`ai-core step-${revealStep} ${isAppraising ? "scanning" : ""}`}>
                  <div className="locked-number">
                    <span>SELECTED NUMBER</span>
                    <strong>{revealStep >= 4 ? lockedResults[activeRevealIndex]?.number : "LOCKED"}</strong>
                  </div>

                  {revealStep === 0 && (
                    <div className="reveal-panel intro-panel">
                      <span className="panel-kicker">RESULT ENCRYPTED</span>
                      <h3>결과가 확정되었습니다</h3>
                      <p>
                        분석이 끝나도 결과는 숨겨집니다. 공개 버튼을 누르면
                        희귀도, 가치, 상품이 함께 표시됩니다.
                      </p>
                    </div>
                  )}

                  {revealStep === 1 && (
                    <div className="reveal-panel scan-panel">
                      <div className="scanner-orb"><span /></div>
                      <span className="panel-kicker">AI ANALYZING</span>
                      <h3>상품 데이터 분석 중</h3>
                      <div className="analysis-lines"><i /><i /><i /></div>
                    </div>
                  )}

                  {revealStep >= 2 && (
                    <div className="reveal-panel result-panel">
                      <div
                        className={`result-row rarity-row ${
                          revealStep >= 4 ? "visible" : "locked"
                        }`}
                      >
                        <span>희귀도</span>
                        <strong
                          className={
                            revealStep >= 4
                              ? `rarity rarity-${lockedResults[activeRevealIndex]?.rarity}`
                              : ""
                          }
                        >
                          {revealStep >= 4
                            ? lockedResults[activeRevealIndex]?.rarity
                            : "비공개"}
                        </strong>
                      </div>

                      <div
                        className={`result-row value-row ${
                          revealStep >= 4 ? "visible" : "locked"
                        }`}
                      >
                        <span>가치</span>
                        <strong>
                          {revealStep >= 4
                            ? "★".repeat(
                                lockedResults[activeRevealIndex]?.stars || 0,
                              ) +
                              "☆".repeat(
                                5 -
                                  (lockedResults[activeRevealIndex]?.stars || 0),
                              )
                            : "비공개"}
                        </strong>
                      </div>

                      <div
                        className={`product-reveal ${
                          revealStep >= 4 ? "visible" : "locked"
                        }`}
                        style={{
                          position: "relative",
                          overflow: "hidden",
                          width: "980px",
                          minWidth: "980px",
                          maxWidth: "980px",
                          height: "140px",
                          minHeight: "140px",
                          maxHeight: "140px",
                          margin: "30px auto 0",
                          padding: 0,
                          flex: "0 0 980px",
                          boxSizing: "border-box",
                        }}
                      >
                        <span>FINAL PRODUCT</span>
                        {revealStep >= 4 && (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "100px 1fr",
                              gap: "10px",
                              alignItems: "center",
                              width: "100%",
                              height: "100%",
                              marginTop: 0,
                              padding: "21px 12px 8px",
                              boxSizing: "border-box",
                            }}
                          >
                            <div
                              style={{
                                width: "100px",
                                height: "100px",
                                borderRadius: "8px",
                                overflow: "hidden",
                                background: "#0a121c",
                                border: "1px solid rgba(255,255,255,.12)",
                              }}
                            >
                              {lockedResults[activeRevealIndex]?.image && (
                                <img
                                  src={lockedResults[activeRevealIndex].image}
                                  alt={lockedResults[activeRevealIndex].prizeName}
                                  style={{width:"100%",height:"100%",objectFit:"cover"}}
                                />
                              )}
                            </div>
                            <div style={{textAlign:"left"}}>
                              <h3
                                style={{
                                  fontSize: "30px",
                                  lineHeight: 1.15,
                                  margin: "0 0 5px",
                                  fontWeight: 900,
                                }}
                              >
                                {lockedResults[activeRevealIndex]?.prizeName}
                              </h3>
                              <p
                                style={{
                                  fontSize: "20px",
                                  lineHeight: 1.2,
                                  margin: 0,
                                  fontWeight: 700,
                                  opacity: 0.9,
                                }}
                              >
                                {lockedResults[activeRevealIndex]?.grade}
                              </p>
                            </div>
                          </div>
                        )}

                        {revealStep >= 4 &&
                          !openedProductIndexes.includes(activeRevealIndex) && (
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label="드래그해서 최종 상품 공개"
                              onPointerDown={(event) =>
                                handleProductPointerDown(
                                  event,
                                  activeRevealIndex,
                                )
                              }
                              onPointerMove={(event) =>
                                handleProductPointerMove(
                                  event,
                                  activeRevealIndex,
                                )
                              }
                              onPointerUp={(event) =>
                                finishProductDrag(event, activeRevealIndex)
                              }
                              onPointerCancel={(event) =>
                                finishProductDrag(event, activeRevealIndex)
                              }
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                zIndex: 20,
                                display: "grid",
                                placeItems: "center",
                                padding: "8px",
                                borderRadius: "inherit",
                                boxSizing: "border-box",
                                border:
                                  "1px solid rgba(255, 211, 77, 0.42)",
                                background: "#07101d",
                                boxShadow:
                                  "inset 0 1px 0 rgba(255,255,255,.08), 0 12px 26px rgba(0,0,0,.24)",
                                opacity: 1,
                                backgroundColor: "#07101d",
                                backgroundImage: "none",
                                backdropFilter: "none",
                                transform: `translateX(${
                                  productDragOffsets[activeRevealIndex]?.x || 0
                                }px)`,
                                transition:
                                  draggingProductIndex === activeRevealIndex
                                    ? "none"
                                    : "transform 220ms ease",
                                touchAction: "none",
                                pointerEvents: "auto",
                                cursor:
                                  draggingProductIndex === activeRevealIndex
                                    ? "grabbing"
                                    : "grab",
                                userSelect: "none",
                              }}
                            >
                              <div style={{ textAlign: "center" }}>
                                <strong
                                  style={{
                                    display: "block",
                                    color: "#ffd34d",
                                    fontSize: "14px",
                                    letterSpacing: ".08em",
                                  }}
                                >
                                  FINAL PRODUCT
                                </strong>
                                <span
                                  style={{
                                    display: "block",
                                    marginTop: "8px",
                                    color: "rgba(226,232,240,.76)",
                                    fontSize: "12px",
                                  }}
                                >
                                  마우스로 잡고 옆으로 밀어서 공개
                                </span>
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              className="reveal-steps"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "22px",
                width: "100%",
                maxWidth: "none",
                padding: "0 46px",
                boxSizing: "border-box",
              }}
            >
              {[
                { label: "번호 선택", active: revealStep >= 0 },
                { label: "AI 분석", active: revealStep >= 1 },
                { label: "FINAL PRODUCT 공개", active: revealStep >= 4 },
              ].map((step, index) => (
                <div
                  key={step.label}
                  className={step.active ? "active" : ""}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    minHeight: "48px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "9px",
                    margin: 0,
                    boxSizing: "border-box",
                  }}
                >
                  <b>{index + 1}</b>
                  <span>{step.label}</span>
                </div>
              ))}
            </div>

            <div className="appraisal-footer reveal-footer">
              {!appraisalFinished ? (
                <>
                  <button type="button" className="appraisal-cancel-button" onClick={cancelAppraisal} disabled={isAppraising}>닫기</button>
                  <button type="button" className="appraisal-confirm-button reveal-action" onClick={advanceReveal} disabled={isAppraising}>
                    {isAppraising
                      ? "AI 분석 중..."
                      : revealStep === 0
                        ? "AI 분석 시작"
                        : revealStep === 2
                          ? "희귀도 · 가치 · 상품 한 번에 공개"
                          : "다음 번호"}
                  </button>
                </>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      openedProductIndexes.length < lockedResults.length
                        ? "minmax(220px, 0.7fr) minmax(260px, 1fr)"
                        : "1fr",
                    gap: "14px",
                    width: "100%",
                  }}
                >
                  {openedProductIndexes.length < lockedResults.length && (
                    <button
                      type="button"
                      className="appraisal-cancel-button"
                      onClick={openAllProducts}
                      style={{
                        minHeight: "54px",
                        borderColor: "rgba(255,211,77,.72)",
                        color: "#ffd34d",
                        background:
                          "linear-gradient(180deg, rgba(83,65,8,.34), rgba(36,28,4,.54))",
                        boxShadow: "0 0 20px rgba(255,202,48,.1)",
                        fontWeight: 900,
                      }}
                    >
                      한 번에 오픈하기
                    </button>
                  )}

                  <button
                    type="button"
                    className="appraisal-confirm-button"
                    onClick={confirmAppraisal}
                    disabled={
                      openedProductIndexes.length < lockedResults.length
                    }
                    title={
                      openedProductIndexes.length < lockedResults.length
                        ? "드래그하거나 한 번에 오픈하기를 눌러 상품을 공개해 주세요."
                        : "감정 종료"
                    }
                    style={{
                      opacity:
                        openedProductIndexes.length < lockedResults.length
                          ? 0.46
                          : 1,
                      cursor:
                        openedProductIndexes.length < lockedResults.length
                          ? "not-allowed"
                          : "pointer",
                    }}
                  >
                    {openedProductIndexes.length < lockedResults.length
                      ? `FINAL PRODUCT 공개 ${
                          openedProductIndexes.length
                        }/${lockedResults.length}`
                      : "감정 종료"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {showRandomNumberPicker && (
        <div className="normal-modal-backdrop random-number-modal-backdrop">
          <section className="normal-modal random-number-modal">
            <div className="modal-heading">
              <div>
                <span className="small-label">RANDOM NUMBER PICKER</span>
                <h2>번호 랜덤 추첨</h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isNumberShuffling) {
                    setShowRandomNumberPicker(false);
                    setPendingRandomNumbers([]);
                    setShufflePreviewNumbers([]);
                    setShuffleProgress(0);
                  }
                }}
                disabled={isNumberShuffling}
              >
                ✕
              </button>
            </div>

            <div className="random-number-info">
              <div>
                <span>참가자</span>
                <strong>{currentParticipant?.nickname || "-"}</strong>
              </div>
              <div>
                <span>뽑을 번호</span>
                <strong>{randomPickCount}개</strong>
              </div>
              <div>
                <span>남은 번호</span>
                <strong>{remainingCount}개</strong>
              </div>
            </div>

            <div className="random-picker-settings-grid">
              <label className="shuffle-count-field">
                번호를 몇 개 뽑을까요?
                <div className="shuffle-count-control">
                  <button
                    type="button"
                    onClick={() =>
                      setRandomPickCount((current) =>
                        Math.max(1, current - 1),
                      )
                    }
                    disabled={isNumberShuffling}
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, remainingCount)}
                    value={randomPickCount}
                    onChange={(event) =>
                      setRandomPickCount(
                        Math.max(
                          1,
                          Math.min(
                            remainingCount,
                            Number(event.target.value) || 1,
                          ),
                        ),
                      )
                    }
                    disabled={isNumberShuffling}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setRandomPickCount((current) =>
                        Math.min(remainingCount, current + 1),
                      )
                    }
                    disabled={isNumberShuffling}
                  >
                    ＋
                  </button>
                </div>
                <small>
                  현재 남은 번호 안에서 원하는 개수를 선택할 수 있습니다.
                </small>
              </label>

              <label className="random-sound-toggle">
                <input
                  type="checkbox"
                  checked={randomSoundEnabled}
                  onChange={(event) =>
                    setRandomSoundEnabled(event.target.checked)
                  }
                  disabled={isNumberShuffling}
                />
                <span className="random-sound-switch" />
                <div>
                  <strong>추첨 소리</strong>
                  <small>
                    섞기 효과음과 번호 확정 완료음을 재생합니다.
                  </small>
                </div>
              </label>
            </div>

            <label className="shuffle-count-field">
              몇 번 섞을까요?
              <div className="shuffle-count-control">
                <button
                  type="button"
                  onClick={() =>
                    setShuffleCount((current) => Math.max(1, current - 1))
                  }
                  disabled={isNumberShuffling}
                >
                  −
                </button>

                <input
                  type="number"
                  min="1"
                  max="30"
                  value={shuffleCount}
                  onChange={(event) =>
                    setShuffleCount(
                      Math.max(
                        1,
                        Math.min(30, Number(event.target.value) || 1),
                      ),
                    )
                  }
                  disabled={isNumberShuffling}
                />

                <button
                  type="button"
                  onClick={() =>
                    setShuffleCount((current) => Math.min(30, current + 1))
                  }
                  disabled={isNumberShuffling}
                >
                  ＋
                </button>
              </div>
              <small>1회부터 최대 30회까지 선택할 수 있습니다.</small>
            </label>

            <div
              className={[
                "random-shuffle-stage",
                isNumberShuffling ? "shuffling" : "",
                isShuffleSettled ? "settled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="shuffle-stage-head">
                <span>
                  {isNumberShuffling
                    ? "번호를 섞는 중"
                    : shufflePreviewNumbers.length > 0
                      ? "번호 선택 완료"
                      : "대기 중"}
                </span>

                <strong>
                  {shuffleProgress} / {shuffleCount}회
                </strong>
              </div>

              <div className="shuffle-progress-track">
                <span
                  style={{
                    width: `${
                      shuffleCount > 0
                        ? Math.min(
                            100,
                            (shuffleProgress / shuffleCount) * 100,
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>

              {!isShuffleSettled ? (
                isNumberShuffling && shufflePreviewNumbers.length > 0 ? (
                  <div
                    className="shuffle-live-numbers"
                    style={{
                      minHeight: "132px",
                      display: "grid",
                      gridTemplateColumns:
                        shufflePreviewNumbers.length <= 1
                          ? "minmax(0, 1fr)"
                          : "repeat(auto-fit, minmax(76px, 1fr))",
                      gap: "9px",
                      alignContent: "center",
                      width: "100%",
                      padding: "16px 4px",
                      boxSizing: "border-box",
                      overflow: "hidden",
                    }}
                  >
                    {shufflePreviewNumbers.map((number, index) => (
                      <strong
                        key={`shuffle-live-${shuffleProgress}-${index}`}
                        style={{
                          display: "grid",
                          placeItems: "center",
                          minWidth: 0,
                          minHeight:
                            shufflePreviewNumbers.length <= 1 ? "96px" : "68px",
                          padding: "8px 5px",
                          borderRadius: "12px",
                          border: "1px solid rgba(38, 208, 255, .68)",
                          background:
                            "linear-gradient(180deg, rgba(13, 91, 126, .96), rgba(4, 39, 58, .98))",
                          boxShadow:
                            "0 0 18px rgba(30, 202, 255, .16), inset 0 0 22px rgba(31, 198, 255, .12)",
                          color: "#fff",
                          fontSize:
                            shufflePreviewNumbers.length <= 1
                              ? "38px"
                              : shufflePreviewNumbers.length > 20
                                ? "19px"
                                : "27px",
                          lineHeight: 1,
                          transform: "scale(1)",
                        }}
                      >
                        {number}
                      </strong>
                    ))}
                  </div>
                ) : (
                  <div
                    className="shuffle-waiting-summary"
                    style={{
                      minHeight: "132px",
                      display: "grid",
                      placeItems: "center",
                      padding: "24px 12px",
                      textAlign: "center",
                      overflow: "hidden",
                    }}
                  >
                    <div>
                      <div
                        aria-hidden="true"
                        style={{
                          fontSize: "38px",
                          lineHeight: 1,
                          marginBottom: "14px",
                        }}
                      >
                        ◎
                      </div>
                      <strong
                        style={{
                          display: "block",
                          color: "#f4f8ff",
                          fontSize: "24px",
                          lineHeight: 1.25,
                        }}
                      >
                        {randomPickCount}개 추첨 예정
                      </strong>
                      <span
                        style={{
                          display: "block",
                          marginTop: "10px",
                          color: "#8aa7bd",
                          fontSize: "13px",
                        }}
                      >
                        추첨 시작 버튼을 누르면 번호를 선택합니다.
                      </span>
                    </div>
                  </div>
                )
              ) : (
                <div
                  className="shuffle-final-results"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(76px, 1fr))",
                    gap: "9px",
                    width: "100%",
                    padding: "14px 4px 4px",
                    boxSizing: "border-box",
                    overflow: "hidden",
                  }}
                >
                  {shufflePreviewNumbers.map((number, index) => (
                    <strong
                      className="final-number"
                      key={`random-result-${number}-${index}`}
                      style={{
                        display: "grid",
                        placeItems: "center",
                        minWidth: 0,
                        minHeight: "68px",
                        padding: "8px 5px",
                        borderRadius: "12px",
                        border: "1px solid rgba(38, 208, 255, .42)",
                        background:
                          "linear-gradient(180deg, rgba(11, 72, 101, .92), rgba(4, 34, 52, .96))",
                        boxShadow: "inset 0 0 18px rgba(31, 198, 255, .10)",
                        color: "#fff",
                        fontSize: shufflePreviewNumbers.length > 20 ? "19px" : "25px",
                        lineHeight: 1,
                      }}
                    >
                      {number}
                    </strong>
                  ))}
                </div>
              )}

              {isShuffleSettled && shufflePreviewNumbers.length > 0 && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "12px",
                    borderRadius: "11px",
                    background: "rgba(255,211,77,.08)",
                    border: "1px solid rgba(255,211,77,.18)",
                    wordBreak: "break-word",
                    fontSize: "14px",
                    lineHeight: 1.65,
                  }}
                >
                  <b style={{ color: "#ffd34d" }}>
                    최종 선택 {shufflePreviewNumbers.length}개
                  </b>
                  <div style={{ marginTop: "5px" }}>
                    {shufflePreviewNumbers.join(", ")}
                  </div>
                </div>
              )}

              <p>
                {isNumberShuffling
                  ? `${shuffleProgress}번째 섞기 진행 중입니다.`
                  : "번호만 선택되며 상품 추첨은 진행되지 않습니다."}
              </p>
            </div>

            <div className="random-number-modal-actions">
              <button
                type="button"
                className="random-modal-cancel"
                onClick={() => {
                  const hadLockedResult = isShuffleSettled;
                  setShowRandomNumberPicker(false);
                  setIsShuffleSettled(false);
                  setPendingRandomNumbers([]);
                  setShufflePreviewNumbers([]);
                  setShuffleProgress(0);
                  if (hadLockedResult) {
                    setNotice("추첨 번호는 잠금 상태로 보관됩니다. 다시 열어도 같은 번호가 복구됩니다.");
                  }
                }}
                disabled={isNumberShuffling}
              >
                {isShuffleSettled ? "닫기" : "취소"}
              </button>

              <button
                type="button"
                className="random-modal-start"
                onClick={() => {
                  if (isShuffleSettled) {
                    const confirmedRandomNumbers = [...pendingRandomNumbers].sort(
                      (a, b) => a - b,
                    );

                    setManualNumbers(confirmedRandomNumbers);
                    setLastConfirmedNumbers(confirmedRandomNumbers);
                    setRevealMode(
                      confirmedRandomNumbers.length > 1
                        ? "simultaneous"
                        : "sequential",
                    );

                    setShowRandomNumberPicker(false);
                    setIsShuffleSettled(false);
                    setPendingRandomNumbers([]);
                    setShufflePreviewNumbers([]);
                    setShuffleProgress(0);
                    setNotice(
                      `${confirmedRandomNumbers.length}개 번호가 선택되었습니다. 상품 추첨 버튼을 눌러 진행해 주세요.`,
                    );
                    return;
                  }

                  runRandomNumberPicker();
                }}
                disabled={
                  isNumberShuffling ||
                  !currentParticipant ||
                  randomPickCount < 1 ||
                  randomPickCount > remainingCount
                }
              >
                <span>{isShuffleSettled ? "✓" : "⟳"}</span>
                {isNumberShuffling
                  ? `${shuffleProgress} / ${shuffleCount}회 섞는 중`
                  : isShuffleSettled
                    ? `확인하고 번호 선택 (${pendingRandomNumbers.length}개)`
                    : `${shuffleCount}번 섞고 ${randomPickCount}개 뽑기`}
              </button>
            </div>
          </section>
        </div>
      )}

      {showSettings && (
        <div className="normal-modal-backdrop">
          <section className="normal-modal">
            <div className="modal-heading">
              <div>
                <span className="small-label">GAME SETTINGS</span>
                <h2>회차 설정</h2>
              </div>

              <button
                type="button"
                onClick={() => setShowSettings(false)}
              >
                ✕
              </button>
            </div>

            <label>
              회차명
              <input
                value={roundTitle}
                onChange={(event) => setRoundTitle(event.target.value)}
              />
            </label>

            <label>
              입금 계좌
              <input
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              />
            </label>

            <label>
              번호 1개 가격
              <input
                type="number"
                min="0"
                value={price}
                onChange={(event) =>
                  setPrice(Math.max(0, Number(event.target.value) || 0))
                }
              />
            </label>

            <label>
              전체 번호 개수
              <input
                type="number"
                min="1"
                value={totalNumbers}
                onChange={(event) =>
                  setTotalNumbers(
                    Math.max(1, Number(event.target.value) || 1),
                  )
                }
              />
            </label>

            <div
              style={{
                marginTop: 18,
                padding: 16,
                border: "1px solid rgba(45, 212, 191, 0.28)",
                borderRadius: 14,
                background: "rgba(8, 22, 34, 0.72)",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>자동 백업</div>
              <div style={{ opacity: 0.72, fontSize: 13, marginBottom: 12 }}>
                5분마다 브라우저에 저장하며 최근 30개를 보관합니다.
                <br />
                {backupStatus}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                <button type="button" onClick={createManualBackup}>
                  지금 백업
                </button>
                <button type="button" onClick={downloadLatestBackup}>
                  JSON 저장
                </button>
                <button type="button" onClick={restoreLatestBackup}>
                  최근 백업 복원
                </button>
              </div>
            </div>

            <button
              type="button"
              className="settings-save-button"
              onClick={() => setShowSettings(false)}
            >
              설정 저장
            </button>
          </section>
        </div>
      )}


      {isPrizePanelOpen && (
        <div
          className="prize-panel-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsPrizePanelOpen(false);
            }
          }}
        >
          <section
            className="prize-panel-drawer prize-panel-dashboard"
            style={{
              position: "fixed",
              inset: "12px",
              width: "auto",
              height: "auto",
              maxWidth: "none",
              maxHeight: "none",
              margin: 0,
              transform: "none",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="상품 현황 패널"
          >
            <div
              className="prize-panel-drawer-head dashboard-panel-head"
              style={{
                boxSizing: "border-box",
                paddingLeft: "24px",
                paddingRight: "24px",
                flexShrink: 0,
              }}
            >
              <div>
                <span className="small-label">LUCKY KUJI LIVE DISTRIBUTION</span>
                <h2>상품 패널</h2>
              </div>

              <div className="dashboard-head-stats">
                <span>전체 <b>{totalNumbers}</b></span>
                <span>판매 <b>{totalNumbers - remainingCount}</b></span>
                <span>남음 <b>{remainingCount}</b></span>
              </div>

              <button
                type="button"
                className="prize-panel-close"
                style={{ flexShrink: 0, marginRight: 0 }}
                onClick={() => setIsPrizePanelOpen(false)}
                aria-label="상품 패널 닫기"
              >
                × 닫기
              </button>
            </div>

            <div className="prize-dashboard-grid">
              <section className="prize-dashboard-pane distribution-pane">
                <div className="dashboard-section-head">
                  <div>
                    <span>등급 분포 · DISTRIBUTION</span>
                    <h3>남은 등급 현황</h3>
                  </div>
                </div>

                <div className="rarity-distribution-list">
                  {["S", "A", "B", "C"].map((rarity) => {
                    const rarityPrizes = effectivePrizes.filter(
                      (prize) => !prize.isCoupon && getPrizeRarity(prize).rarity === rarity,
                    );
                    const rarityTotal = rarityPrizes.reduce(
                      (sum, prize) => sum + Math.max(0, Number(prize.total) || 0),
                      0,
                    );
                    const rarityRemaining = rarityPrizes.reduce(
                      (sum, prize) => sum + Math.max(0, Number(prize.remaining) || 0),
                      0,
                    );

                    if (rarityTotal <= 0) return null;

                    return (
                      <div className={`rarity-distribution-row rarity-${rarity.toLowerCase()}`} key={rarity}>
                        <span className="rarity-light" aria-hidden="true" />
                        <strong>{rarity} 등급</strong>
                        <b>{rarityRemaining} / {rarityTotal}</b>
                      </div>
                    );
                  })}
                </div>

                <div className="dashboard-subheading">
                  <span>상품 목록</span>
                  <b>{effectivePrizes.filter((prize) => !prize.isCoupon).length}종</b>
                </div>

                <div className="compact-product-list">
                  {sortedEffectivePrizes
                    .filter((prize) => !prize.isCoupon)
                    .map((prize) => {
                      const rarity = getPrizeRarity(prize).rarity;
                      const soldOut = Number(prize.remaining) <= 0;

                      return (
                        <article
                          className={`compact-product-row ${soldOut ? "sold-out" : ""}`}
                          key={prize.id}
                        >
                          <div className="compact-product-thumb">
                            {prize.image ? (
                              <img src={prize.image} alt={prize.name} />
                            ) : (
                              <span>{String(prize.name).slice(0, 2)}</span>
                            )}
                          </div>
                          <span className={`compact-rarity rarity-${rarity.toLowerCase()}`}>{rarity}</span>
                          <div className="compact-product-copy">
                            <strong>{prize.name}</strong>
                            <small>{prize.grade}</small>
                          </div>
                          <b className={soldOut ? "empty-count" : ""}>
                            {prize.remaining}/{prize.total}
                          </b>
                        </article>
                      );
                    })}
                </div>
              </section>

              <section className="prize-dashboard-pane product-gallery-pane">
                <div className="dashboard-section-head">
                  <div>
                    <span>감정상품 · LIVE INVENTORY</span>
                    <h3>현재 상품 구성</h3>
                  </div>
                  <b>
                    {effectivePrizes.reduce(
                      (sum, prize) => sum + Math.max(0, Number(prize.remaining) || 0),
                      0,
                    )} 남음
                  </b>
                </div>

                <div className="dashboard-product-grid">
                  {sortedEffectivePrizes
                    .filter((prize) => !prize.isCoupon)
                    .map((prize) => {
                      const rarity = getPrizeRarity(prize).rarity;
                      const soldOut = Number(prize.remaining) <= 0;

                      return (
                        <article
                          className={`dashboard-product-card rarity-${rarity.toLowerCase()} ${soldOut ? "sold-out" : ""}`}
                          key={prize.id}
                        >
                          <span className="dashboard-product-rarity">{rarity}</span>
                          <div className="dashboard-product-image">
                            {prize.image ? (
                              <img src={prize.image} alt={prize.name} />
                            ) : (
                              <span>{String(prize.name).slice(0, 2)}</span>
                            )}
                            {soldOut && <em>SOLD OUT</em>}
                          </div>
                          <div className="dashboard-product-info">
                            <strong>{prize.name}</strong>
                            <span>{prize.grade}</span>
                            <b className={soldOut ? "empty-count" : ""}>
                              {prize.remaining} / {prize.total}
                            </b>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </section>

              <section className="prize-dashboard-pane result-pane">
                <div className="dashboard-section-head">
                  <div>
                    <span>감정 결과 · OUTGOING</span>
                    <h3>실시간 당첨 기록</h3>
                  </div>
                  <b>
                    {history.reduce(
                      (sum, entry) => sum + (entry.results?.length || 0),
                      0,
                    )}건
                  </b>
                </div>

                <div className="dashboard-result-list">
                  {history.length === 0 ? (
                    <div className="empty-panel-state">아직 감정 결과가 없습니다.</div>
                  ) : (
                    history
                      .slice()
                      .reverse()
                      .flatMap((entry) =>
                        (entry.results || []).map((result, index) => {
                          const matchedPrize = effectivePrizes.find(
                            (prize) => String(prize.id) === String(result.prizeId),
                          );
                          const rarity = String(
                            result.rarity || getPrizeRarity(matchedPrize || result).rarity || "B",
                          ).toUpperCase();

                          return (
                            <article
                              className={`dashboard-result-row rarity-${rarity.toLowerCase()}`}
                              key={`${entry.id}-${result.number}-${index}`}
                            >
                              <b className="dashboard-result-number">#{result.number}</b>
                              <strong className="dashboard-result-player">{entry.nickname}</strong>
                              <span className="dashboard-result-rarity">{rarity}</span>
                              <span className="dashboard-result-prize" title={result.prizeName}>
                                {result.prizeName}
                              </span>
                            </article>
                          );
                        }),
                      )
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      )}

      {showHistory && (
        <div className="normal-modal-backdrop">
          <section className="normal-modal history-modal">
            <div className="modal-heading">
              <div>
                <span className="small-label">DRAW HISTORY</span>
                <h2>진행 기록</h2>
              </div>

              <button
                type="button"
                onClick={() => setShowHistory(false)}
              >
                ✕
              </button>
            </div>

            <div className="history-list">
              {history.length === 0 ? (
                <p className="empty-history">진행 기록이 없습니다.</p>
              ) : (
                history.map((item) => (
                  <article className="history-item" key={item.id}>
                    <div>
                      <strong>{item.nickname}</strong>
                      <span>
                        {item.mode || "번호 선택"} · {item.createdAt}
                      </span>
                    </div>

                    <div className="history-result-list">
                      {(item.results || []).map((result, index) => (
                        <div
                          className="history-result-row"
                          key={`${item.id}-${result.number}-${index}`}
                        >
                          <b>{result.number}번</b>
                          <span>{result.prizeName}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function App() {
  const { user, loading, login, logout } = useAuth();

  if (loading) {
    return (
      <main className="login-page">
        <section className="login-card" aria-live="polite">
          <div className="login-logo">LK</div>
          <p className="small-label">SECURE SESSION</p>
          <h1>LuckyKuji</h1>
          <p className="login-description">
            관리자 로그인 상태를 확인하고 있습니다...
          </p>
        </section>
      </main>
    );
  }

  if (!user) {
    return <LoginPage onLogin={login} />;
  }

  return <LivePage onLogout={logout} user={user} />;
}

export default App;