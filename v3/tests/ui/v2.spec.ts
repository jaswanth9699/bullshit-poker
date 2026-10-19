import { expect, test, type Page } from "@playwright/test";

async function createRoomFromEntry(
  page: Page,
  name: string,
  pin: string,
): Promise<void> {
  await page.getByRole("button", { name: /Create Table/i }).click();
  await page.getByPlaceholder("Enter your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("Choose a 4-digit PIN").fill(pin);
  await page.getByRole("button", { name: "Create Room" }).click();
}

async function expectMaskedGamePin(
  page: Page,
  placeholder: string,
): Promise<void> {
  const pinInput = page.getByPlaceholder(placeholder);
  await expect(pinInput).toHaveAttribute("type", "text");
  await expect(pinInput).toHaveAttribute("autocomplete", "off");
  await expect(pinInput).toHaveAttribute("inputmode", "numeric");
  await expect(pinInput).toHaveAttribute("data-1p-ignore", "true");
  await expect(pinInput).toHaveAttribute("data-bwignore", "true");
  await expect(pinInput).toHaveAttribute("data-lpignore", "true");
  expect(
    await pinInput.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("-webkit-text-security"),
    ),
  ).toBe("disc");
}

async function expectCollisionFreeLobbySignals(page: Page): Promise<void> {
  const geometry = await page.locator(".lobby-orbit-zone").evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".lobby-orbit-avatar, .lobby-orbit-copy > *, .lobby-open-seat, .lobby-table-message > *, .lobby-table-names > span",
      ),
    )
      .map((element, index) => {
        const measuresText = element.matches(
          ".lobby-orbit-copy > *, .lobby-table-message > *",
        );
        const range = document.createRange();
        if (measuresText) range.selectNodeContents(element);
        const elementRect = element.getBoundingClientRect();
        const textRect = measuresText ? range.getBoundingClientRect() : null;
        const rect = textRect
          ? {
              left: Math.max(elementRect.left, textRect.left),
              right: Math.min(elementRect.right, textRect.right),
              top: Math.max(elementRect.top, textRect.top),
              bottom: Math.min(elementRect.bottom, textRect.bottom),
              width:
                Math.min(elementRect.right, textRect.right) -
                Math.max(elementRect.left, textRect.left),
              height:
                Math.min(elementRect.bottom, textRect.bottom) -
                Math.max(elementRect.top, textRect.top),
            }
          : elementRect;
        const seat = element.closest<HTMLElement>(".lobby-orbit-seat");
        return {
          key: `${seat?.ariaLabel ? `${seat.ariaLabel} ` : ""}${element.className || element.tagName}-${index}`,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((rect) => rect.width > 0.5 && rect.height > 0.5);

    const collisions: string[] = [];
    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < candidates.length;
        rightIndex += 1
      ) {
        const left = candidates[leftIndex];
        const right = candidates[rightIndex];
        const horizontalOverlap =
          Math.min(left.right, right.right) - Math.max(left.left, right.left);
        const verticalOverlap =
          Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        if (horizontalOverlap > 1 && verticalOverlap > 1) {
          collisions.push(`${left.key} overlaps ${right.key}`);
        }
      }
    }

    const viewportWidth = document.documentElement.clientWidth;
    const outsideViewport = candidates
      .filter((rect) => rect.left < -0.5 || rect.right > viewportWidth + 0.5)
      .map((rect) => rect.key);

    return {
      collisions,
      outsideViewport,
      pageOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });

  expect(geometry.collisions).toEqual([]);
  expect(geometry.outsideViewport).toEqual([]);
  expect(geometry.pageOverflow).toBe(0);
}

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "laptop", width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test(`${viewport.name} entry is framed, nonblank, and overflow-free`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "BullShit Poker" }),
    ).toBeVisible();
    const canvas = page.locator(".kinetic-scene canvas");
    await expect(canvas).toBeVisible();
    const scene = page.locator(".kinetic-scene");
    await expect(scene).toHaveAttribute(
      "data-scene-layout",
      viewport.name === "mobile" ? "mobile" : "desktop",
    );
    await expect(scene).toHaveAttribute(
      "data-quality",
      viewport.name === "mobile" ? "balanced" : /^(full|balanced)$/,
    );
    await expect(scene).toHaveAttribute("data-scene-status", "ready");
    await page.waitForTimeout(500);

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox?.width).toBeGreaterThanOrEqual(200);
    expect(canvasBox?.width).toBeLessThan(viewport.width);
    expect(canvasBox?.height).toBeGreaterThanOrEqual(160);
    expect(canvasBox?.height).toBeLessThan(viewport.height);
    const canvasPng = await canvas.screenshot();
    expect(canvasPng.byteLength).toBeGreaterThan(8_000);

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      launcher: document
        .querySelector(".deal-launch-actions")
        ?.getBoundingClientRect()
        .toJSON(),
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
    expect(dimensions.launcher?.width).toBeLessThanOrEqual(viewport.width - 24);
    expect(dimensions.launcher?.height).toBeLessThan(180);
    await page.screenshot({
      path: `test-results/v2-entry-${viewport.name}.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: /Create Table/i }).click();
    await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
    const rail = await page.locator(".deal-rail").boundingBox();
    expect(rail?.width).toBeLessThanOrEqual(
      viewport.name === "mobile" ? viewport.width : 520,
    );
    if (viewport.name === "mobile") {
      expect(rail?.height).toBeLessThanOrEqual(viewport.height * 0.5);
      expect(rail?.height).toBeGreaterThanOrEqual(240);
    } else {
      expect(rail!.height).toBeGreaterThanOrEqual(240);
      expect(rail!.height).toBeLessThan(viewport.height - 48);
      expect(rail!.y).toBeGreaterThan(0);
    }
    await page.screenshot({
      path: `test-results/v2-deal-rail-${viewport.name}.png`,
      fullPage: true,
    });

    await page.getByPlaceholder("Enter your name").fill("Password Mask Test");
    await page.getByRole("button", { name: "Continue" }).click();
    await expectMaskedGamePin(page, "Choose a 4-digit PIN");
    await page.getByRole("button", { name: "Previous step" }).click();
    await page.getByRole("button", { name: "Close deal-in rail" }).click();
    await expect(page.locator(".deal-launch-actions")).toBeVisible();

    await page.getByRole("button", { name: /Join Room/i }).click();
    await page.getByPlaceholder("Enter room code").fill("ABC123");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expectMaskedGamePin(page, "Enter your 4-digit PIN");
    await page.getByRole("button", { name: "Previous step" }).click();
    await page.getByRole("button", { name: "Previous step" }).click();
    await page.getByRole("button", { name: "Close deal-in rail" }).click();
    await expect(page.locator(".deal-launch-actions")).toBeVisible();
  });
}

test("shared room links open the join rail with their code preserved", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?room=ABC123");
  await expect(page.getByText("Join room · 2 of 3")).toBeVisible();
  await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(page.getByPlaceholder("Enter room code")).toHaveValue("ABC123");
});

test("a guest leaving the lobby disappears from the host table immediately", async ({
  browser,
}) => {
  const hostContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const friendContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const hostPage = await hostContext.newPage();
  const friendPage = await friendContext.newPage();

  try {
    await hostPage.goto("/");
    await createRoomFromEntry(hostPage, "Host", "2468");
    const roomCode = await hostPage.locator("[data-room-code]").innerText();

    await friendPage.goto(`/?room=${roomCode}`);
    await friendPage.getByPlaceholder("Enter your name").fill("Sri");
    await friendPage.getByRole("button", { name: "Continue" }).click();
    await friendPage.getByPlaceholder("Enter your 4-digit PIN").fill("1357");
    await friendPage.getByRole("button", { name: "Join Room" }).click();

    await expect(
      hostPage
        .getByLabel("Players at the table")
        .getByText("Sri", { exact: true }),
    ).toBeVisible();
    await expect(
      hostPage
        .getByLabel("Players at the table")
        .getByText("2 / 10 seated", { exact: true }),
    ).toBeVisible();
    await expect(
      hostPage.getByRole("button", { name: "Remove Sri" }),
    ).toBeVisible();
    await expect(
      friendPage.getByRole("button", { name: "Add Bot" }),
    ).toHaveCount(0);
    await expect(friendPage.getByRole("button", { name: "Start" })).toHaveCount(
      0,
    );

    await friendPage.getByRole("button", { name: "Leave game" }).click();
    await friendPage.getByRole("button", { name: "Yes, leave" }).click();

    await expect(
      friendPage.getByRole("heading", { name: "BullShit Poker" }),
    ).toBeVisible();
    await expect(hostPage.getByText("Sri", { exact: true })).toHaveCount(0);
    await expect(
      hostPage
        .getByLabel("Players at the table")
        .getByText("1 / 10 seated", { exact: true }),
    ).toBeVisible();

    await hostPage.getByRole("button", { name: "Add Bot" }).click();
    await hostPage.getByRole("button", { name: "I am ready" }).click();
    await hostPage.getByRole("button", { name: "Start" }).click();
    await expect(hostPage.locator(".opponent-rail")).toBeVisible();
    await expect(hostPage.getByText("Sri", { exact: true })).toHaveCount(0);
    await expect(hostPage.locator(".opponent-rail .player-seat")).toHaveCount(
      2,
    );
  } finally {
    await hostContext.close();
    await friendContext.close();
  }
});

test("an active leaver leaves the rail without changing the frozen round pool", async ({
  browser,
}) => {
  const hostContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const friendContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const hostPage = await hostContext.newPage();
  const friendPage = await friendContext.newPage();

  try {
    await hostPage.goto("/");
    await createRoomFromEntry(hostPage, "Host", "2468");
    const roomCode = await hostPage.locator("[data-room-code]").innerText();

    await friendPage.goto(`/?room=${roomCode}`);
    await friendPage.getByPlaceholder("Enter your name").fill("Sri");
    await friendPage.getByRole("button", { name: "Continue" }).click();
    await friendPage.getByPlaceholder("Enter your 4-digit PIN").fill("1357");
    await friendPage.getByRole("button", { name: "Join Room" }).click();

    await hostPage.getByRole("button", { name: "Add Bot" }).click();
    await friendPage.getByRole("button", { name: "I am ready" }).click();
    await hostPage.getByRole("button", { name: "I am ready" }).click();
    await hostPage.getByRole("button", { name: "Start" }).click();

    const cardTotal = hostPage.locator(".inline-card-total");
    await expect(cardTotal).toHaveText("3");
    await expect(cardTotal).toHaveAttribute("title", "3 cards in play");
    await friendPage.getByRole("button", { name: "Leave game" }).click();
    await friendPage.getByRole("button", { name: "Yes, leave" }).click();

    await expect(hostPage.getByText("Sri", { exact: true })).toHaveCount(0);
    await expect(hostPage.locator(".opponent-rail .player-seat")).toHaveCount(
      2,
    );
    await expect(cardTotal).toHaveText("3");
    await expect(cardTotal).toHaveAttribute("title", "3 cards in play");
    await expect(hostPage.getByText("Round 1", { exact: true })).toBeVisible();
    await expect(
      hostPage.getByRole("button", { name: "Make Claim" }),
    ).toBeEnabled();
  } finally {
    await hostContext.close();
    await friendContext.close();
  }
});

test("mobile room lifecycle and V3 controls work together", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await createRoomFromEntry(page, "Mobile Host", "2468");

  await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
  await expect(page.locator(".bluff-lobby")).toBeVisible();
  await expect(page.locator(".lobby-table-orbit")).toBeVisible();
  const lobbyScene = page.locator('.living-table-scene[data-variant="lobby"]');
  await expect(lobbyScene).toHaveAttribute("data-scene-status", "ready");
  await expect(lobbyScene).toHaveAttribute("data-scene-layout", "mobile");
  const lobbyScenePng = await lobbyScene.locator("canvas").screenshot();
  expect(lobbyScenePng.byteLength).toBeGreaterThan(3_000);
  await expect(page.locator(".lobby-roster-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Invite friends" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Table settings" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "End game" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave game" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeDisabled();
  const lobbyDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(lobbyDimensions.scrollWidth).toBe(lobbyDimensions.clientWidth);
  await page.getByRole("button", { name: "Add Bot" }).click();
  await expect(
    page.getByLabel("Players at the table").getByText("Bot 1", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lobby-orbit-seat")).toHaveCount(2);
  await expect(page.locator(".lobby-roster-row")).toHaveCount(2);
  await page.getByRole("button", { name: "I am ready" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/^your cards$/i)).toBeVisible();
  const gameScene = page.locator('.living-table-scene[data-variant="game"]');
  await expect(gameScene).toHaveAttribute("data-scene-status", "ready");
  await expect(gameScene).toHaveAttribute("data-scene-layout", "mobile");
  const gameScenePng = await gameScene.locator("canvas").screenshot();
  expect(gameScenePng.byteLength).toBeGreaterThan(3_000);
  await expect(page.getByRole("button", { name: "Leave game" })).toBeVisible();
  const tableDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    handGap:
      document.querySelector(".hand-dock")!.getBoundingClientRect().top -
      document.querySelector(".claim-zone")!.getBoundingClientRect().bottom,
  }));
  expect(tableDimensions.scrollWidth).toBe(tableDimensions.clientWidth);
  expect(tableDimensions.handGap).toBeGreaterThanOrEqual(-1);
  expect(tableDimensions.handGap).toBeLessThanOrEqual(24);
  await page.screenshot({
    path: "test-results/v2-game-mobile.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Leave game" }).click();
  await expect(
    page.getByRole("heading", { name: "Do you want to leave the game?" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/v2-leave-mobile.png" });
  await page.getByRole("button", { name: "No" }).click();
  await expect(page.getByText(/^your cards$/i)).toBeVisible();

  await page.getByRole("button", { name: "Share room" }).click();
  await expect(
    page.getByRole("img", { name: /QR code for room/ }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/v2-share-mobile.png" });
  await page.getByRole("button", { name: "Close sharing" }).click();

  await page.getByRole("button", { name: "Table settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Table settings" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/v2-settings-mobile.png" });
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.getByRole("button", { name: "Make Claim" }).click();
  await expect(
    page.getByRole("dialog").getByText("Make Claim", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/v2-claim-mobile.png" });
  await page.getByRole("button", { name: "Royal Flush", exact: true }).click();
  await page.locator(".claim-options button").first().click();
  await expect(
    page.getByRole("button", { name: "Last Round", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Last Round", exact: true }).click();
  await expect(page.getByText("Truth Reveal", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  await page.screenshot({
    path: "test-results/v2-reveal-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Close last round" }).click();

  await page.getByRole("button", { name: "End game" }).click();
  await expect(
    page.getByRole("heading", { name: "End this game for everyone?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Yes, end game" }).click();
  await expect(
    page.getByRole("heading", { name: "The host ended the game" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/v2-result-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Rematch" }).click();
  await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();

  await page.screenshot({
    path: "test-results/v2-lobby-mobile.png",
    fullPage: true,
  });
});

test("personal controls apply haptics and reduced effects", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls: Array<number | number[]> = [];
    Object.defineProperty(window, "__hapticCalls", {
      configurable: true,
      value: calls,
    });
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        calls.push(pattern);
        return true;
      },
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await createRoomFromEntry(page, "Effects Host", "5731");
  await page.getByRole("button", { name: "Table settings" }).click();

  const haptics = page.getByRole("button", { name: /Haptics/ });
  await haptics.click();
  await expect(haptics.locator("i")).toHaveAttribute("aria-label", "Off");
  await haptics.click();
  await expect(haptics.locator("i")).toHaveAttribute("aria-label", "On");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __hapticCalls: Array<number | number[]> })
          .__hapticCalls,
    ),
  ).toContainEqual([14, 24, 14]);

  await page.getByRole("button", { name: /Reduced effects/ }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-effects",
    "true",
  );
  expect(
    await page
      .locator(".live-signal > span:first-child")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");

  const reducedTableScene = page.locator(
    '.living-table-scene[data-effects="reduced"]',
  );
  await expect(reducedTableScene).toHaveAttribute("data-quality", "reduced");
  const reducedTableCanvas = reducedTableScene.locator("canvas");
  const firstTableFrame = await reducedTableCanvas.screenshot();
  await page.waitForTimeout(250);
  const secondTableFrame = await reducedTableCanvas.screenshot();
  expect(firstTableFrame.equals(secondTableFrame)).toBe(true);

  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Leave game" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();

  const scene = page.locator('.kinetic-scene[data-effects="reduced"]');
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute("data-quality", "reduced");
  const canvas = scene.locator("canvas");
  await expect(canvas).toBeVisible();
  const firstFrame = await canvas.screenshot();
  await page.waitForTimeout(250);
  const secondFrame = await canvas.screenshot();
  expect(firstFrame.equals(secondFrame)).toBe(true);
});

test("an accepted claim becomes a shared living-table card formation", async ({
  browser,
}) => {
  const hostContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await hostPage.goto("/");
    await createRoomFromEntry(hostPage, "Visual Host", "2468");
    const roomCode = await hostPage.locator("[data-room-code]").innerText();

    await guestPage.goto(`/?room=${roomCode}`);
    await guestPage.getByPlaceholder("Enter your name").fill("Visual Guest");
    await guestPage.getByRole("button", { name: "Continue" }).click();
    await guestPage.getByPlaceholder("Enter your 4-digit PIN").fill("1357");
    await guestPage.getByRole("button", { name: "Join Room" }).click();

    await guestPage.getByRole("button", { name: "I am ready" }).click();
    await hostPage.getByRole("button", { name: "I am ready" }).click();
    await expect(hostPage.getByRole("button", { name: "Start" })).toBeEnabled();
    await hostPage.getByRole("button", { name: "Start" }).click();
    await expect(
      hostPage.getByRole("button", { name: "Make Claim" }),
    ).toBeEnabled();

    await hostPage.getByRole("button", { name: "Make Claim" }).click();
    await hostPage.getByRole("button", { name: "Pair", exact: true }).click();
    await hostPage.getByRole("button", { name: "Pair of Twos" }).click();

    await expect(
      guestPage.getByText(/previous claim by Visual Host/i),
    ).toBeVisible();
    const scene = guestPage.locator('.living-table-scene[data-variant="game"]');
    await expect(scene).toHaveAttribute("data-scene-status", "ready");
    const claimCanvas = await scene.locator("canvas").screenshot();
    expect(claimCanvas.byteLength).toBeGreaterThan(3_000);
    await guestPage.screenshot({
      path: "test-results/v3-live-claim-mobile.png",
      fullPage: true,
    });
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("laptop table uses one continuous game arena", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await createRoomFromEntry(page, "Desktop Host", "1357");
  await page.getByRole("button", { name: "Add Bot" }).click();
  await expect(page.locator(".lobby-table-orbit")).toBeVisible();
  const lobbyScene = page.locator('.living-table-scene[data-variant="lobby"]');
  await expect(lobbyScene).toHaveAttribute("data-scene-status", "ready");
  await expect(lobbyScene).toHaveAttribute("data-scene-layout", "desktop");
  const lobbyLayout = await page
    .locator(".lobby-world")
    .evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    }));
  expect(lobbyLayout.columns).toBe(3);
  expect(lobbyLayout.overflow).toBe(0);
  await page.screenshot({
    path: "test-results/v2-lobby-laptop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "I am ready" }).click();
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByText(/^your cards$/i)).toBeVisible();
  const gameScene = page.locator('.living-table-scene[data-variant="game"]');
  await expect(gameScene).toHaveAttribute("data-scene-status", "ready");
  await expect(gameScene).toHaveAttribute("data-scene-layout", "desktop");
  const layout = await page.locator(".table-layout").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      columns: style.gridTemplateColumns.split(" ").length,
      width: element.getBoundingClientRect().width,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  });
  expect(layout.columns).toBe(1);
  expect(layout.width).toBeLessThanOrEqual(1460);
  expect(layout.overflow).toBe(0);
  await page.screenshot({
    path: "test-results/v2-game-laptop.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Leave game" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
  await expect(
    page.getByRole("heading", { name: "BullShit Poker" }),
  ).toBeVisible();
});

test("mobile landscape keeps the live table and private hand reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await createRoomFromEntry(page, "Landscape Host", "3141");
  await page.getByRole("button", { name: "Add Bot" }).click();
  await page.getByRole("button", { name: "I am ready" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.locator(".claim-zone")).toBeVisible();
  await expect(page.locator(".hand-dock")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make Claim" })).toBeVisible();
  const landscape = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    claimWidth: document.querySelector(".claim-zone")!.getBoundingClientRect()
      .width,
    handWidth: document.querySelector(".hand-dock")!.getBoundingClientRect()
      .width,
  }));
  expect(landscape.scrollWidth).toBe(landscape.clientWidth);
  expect(landscape.claimWidth).toBeGreaterThan(400);
  expect(landscape.handWidth).toBeGreaterThan(200);
  await page.screenshot({
    path: "test-results/v3-game-mobile-landscape.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Leave game" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
});

test("lobby signals stay collision-free for every table size and viewport", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const viewportsToAudit = [
    { name: "narrow-mobile", width: 320, height: 760 },
    { name: "tablet", width: 768, height: 900 },
    { name: "desktop", width: 1440, height: 900 },
  ];

  for (const viewport of viewportsToAudit) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await createRoomFromEntry(page, "Alexandria Maximum", "9753");
      await expectCollisionFreeLobbySignals(page);

      for (let botNumber = 1; botNumber <= 9; botNumber += 1) {
        await page.getByRole("button", { name: "Add Bot" }).click();
        await expect(page.locator(".lobby-roster-row")).toHaveCount(
          botNumber + 1,
        );
        await expectCollisionFreeLobbySignals(page);

        if (botNumber === 5) {
          await page.screenshot({
            path: `test-results/v2-six-seat-lobby-${viewport.name}.png`,
            fullPage: true,
          });
        }
      }
    } finally {
      await context.close();
    }
  }
});

test("six long human names remain readable without signal collisions", async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const viewport = { width: 320, height: 760 };
  const contexts = [];
  const hostContext = await browser.newContext({ viewport });
  contexts.push(hostContext);
  const hostPage = await hostContext.newPage();

  try {
    await hostPage.goto("/");
    await createRoomFromEntry(hostPage, "Alexandria Maximum", "9753");
    const roomCode = await hostPage.locator("[data-room-code]").innerText();
    const guests = [
      "Christopher Longname",
      "Priyadarshini Rao",
      "Maximilian Santiago",
      "Anastasia Evergreen",
      "Bartholomew Stone",
    ];

    for (const [index, guestName] of guests.entries()) {
      const context = await browser.newContext({ viewport });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto(`/?room=${roomCode}`);
      await page.getByPlaceholder("Enter your name").fill(guestName);
      await page.getByRole("button", { name: "Continue" }).click();
      await page
        .getByPlaceholder("Enter your 4-digit PIN")
        .fill(`${4100 + index}`);
      await page.getByRole("button", { name: "Join Room" }).click();
      await expect(hostPage.locator(".lobby-roster-row")).toHaveCount(
        index + 2,
      );
    }

    await expect(
      hostPage.getByLabel("Lobby table").getByText("Waiting on 6 players"),
    ).toBeVisible();
    await expectCollisionFreeLobbySignals(hostPage);
    await hostPage.screenshot({
      path: "test-results/v2-six-long-names-lobby-mobile.png",
      fullPage: true,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("ten-seat mobile table and full reveal remain reachable", async ({
  page,
}) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await createRoomFromEntry(page, "Long Mobile Player", "8642");

  for (let botNumber = 1; botNumber <= 9; botNumber += 1) {
    await page.getByRole("button", { name: "Add Bot" }).click();
    await expect(
      page
        .getByLabel("Players at the table")
        .getByText(`Bot ${botNumber}`, { exact: true }),
    ).toBeVisible();
  }
  await expect(page.locator(".bluff-lobby")).toHaveAttribute(
    "data-player-count",
    "10",
  );
  await expect(page.locator(".lobby-orbit-seat")).toHaveCount(10);
  await expect(page.locator(".lobby-roster-row")).toHaveCount(10);
  const crowdedLobby = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(crowdedLobby.scrollWidth).toBe(crowdedLobby.clientWidth);
  await page.screenshot({
    path: "test-results/v2-ten-seat-lobby-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "I am ready" }).click();
  await page.getByRole("button", { name: "Start" }).click();

  const rail = page.locator(".opponent-rail");
  await expect(rail).toBeVisible();
  const railDimensions = await rail.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(railDimensions.scrollWidth).toBeGreaterThan(
    railDimensions.clientWidth,
  );
  await expect(
    page.getByText("Long Mobile Player", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/v2-ten-seat-game-mobile.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Make Claim" }).click();
  await page.getByRole("button", { name: "Royal Flush", exact: true }).click();
  await page.locator(".claim-options button").first().click();
  await expect(
    page.getByRole("button", { name: "Last Round", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Last Round", exact: true }).click();
  await expect(page.getByText("Truth Reveal", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  const revealed = page.locator(".revealed-group");
  await expect(revealed).toHaveCount(10);
  await revealed.last().scrollIntoViewIfNeeded();
  await expect(revealed.last()).toBeVisible();
  await page.screenshot({
    path: "test-results/v2-ten-seat-reveal-mobile.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Close last round" }).click();
  await page.getByRole("button", { name: "Leave game" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
  await expect(
    page.getByRole("heading", { name: "BullShit Poker" }),
  ).toBeVisible();
});

test("production smoke creates and permanently leaves a disposable room", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "BullShit Poker" }),
  ).toBeVisible();
  await expect(page.locator(".kinetic-scene")).toHaveAttribute(
    "data-scene-layout",
    "mobile",
  );

  await createRoomFromEntry(page, "Deploy Smoke", "4826");
  await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
  await page.getByRole("button", { name: "Leave game" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
  await expect(
    page.getByRole("heading", { name: "BullShit Poker" }),
  ).toBeVisible();
});
