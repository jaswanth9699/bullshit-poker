import { expect, test, type Browser, type Page } from "@playwright/test";

const seatKey = "bullshit-poker-v3-seat";

async function createRoom(page: Page, name = "Recovery Host") {
  await page.goto("/");
  await page.getByRole("button", { name: /Create Table/i }).click();
  await page.getByPlaceholder("Enter your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByPlaceholder("Choose a 4-digit PIN").fill("2468");
  await page.getByRole("button", { name: "Create Room" }).click();
  await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
  return page.locator("[data-room-code]").innerText();
}

async function humanTable(browser: Browser, deviceScaleFactor = 1) {
  const hostContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor,
  });
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor,
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const code = await createRoom(host);
  await guest.goto(`/?room=${code}`);
  await guest.getByPlaceholder("Enter your name").fill("Recovery Guest");
  await guest.getByRole("button", { name: "Continue" }).click();
  await guest.getByPlaceholder("Enter your 4-digit PIN").fill("1357");
  await guest.getByRole("button", { name: "Join Room" }).click();
  await guest.getByRole("button", { name: "I am ready" }).click();
  await host.getByRole("button", { name: "I am ready" }).click();
  await host.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    host.getByRole("button", { name: "Make Claim", exact: true }),
  ).toBeEnabled();
  await expect(guest.locator(".hand-dock")).toBeVisible();
  return {
    host,
    guest,
    code,
    hostContext,
    guestContext,
    close: async () => {
      await hostContext.close();
      await guestContext.close();
    },
  };
}

async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBe(0);
}

test("entry choreography runs through create and join, stops offscreen and respects system Reduced Motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const scene = page.locator(".kinetic-scene");
  const canvas = scene.locator("canvas");
  await expect(scene).toHaveAttribute("data-motion-playing", "true");
  const mobileOuterCards = page.locator(".entry-edge-card");
  await expect(mobileOuterCards).toHaveCount(4);
  for (const card of await mobileOuterCards.all())
    await expect(card).toBeVisible();
  const mobileBefore = await mobileOuterCards.evaluateAll((cards) =>
    cards.map((card) => getComputedStyle(card).transform),
  );
  await page.waitForTimeout(600);
  const mobileAfter = await mobileOuterCards.evaluateAll((cards) =>
    cards.map((card) => getComputedStyle(card).transform),
  );
  mobileAfter.forEach((pose, index) =>
    expect(pose).not.toBe(mobileBefore[index]),
  );
  const initial = await canvas.screenshot();
  await expect(scene).toHaveAttribute("data-motion-phase", "suspend", {
    timeout: 7000,
  });
  expect((await canvas.screenshot()).equals(initial)).toBe(false);
  await page.screenshot({
    path: "test-results/choreography-fan-mobile.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Replay card animation" }),
  ).toHaveCount(0);
  for (const mode of [/Create Table/, /Join Room/]) {
    await page.getByRole("button", { name: mode }).click();
    await expect(scene).toHaveAttribute("data-motion-playing", "true");
    const active = await canvas.screenshot();
    await page.waitForTimeout(300);
    expect((await canvas.screenshot()).equals(active)).toBe(false);
    await page.getByRole("button", { name: "Close deal-in rail" }).click();
  }
  await page.setViewportSize({ width: 390, height: 90 });
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(scene).toHaveAttribute("data-motion-playing", "false");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(scene).toHaveAttribute("data-motion-playing", "true");
  await page.mouse.move(1100, 330);
  await expect(scene).toHaveAttribute("data-motion-phase", "suspend", {
    timeout: 7000,
  });
  const outerCards = page.locator(".entry-edge-card");
  await expect(outerCards).toHaveCount(4);
  const readOuterPoses = () =>
    outerCards.evaluateAll((cards) =>
      cards.map((card) => getComputedStyle(card).transform),
    );
  const outerBefore = await readOuterPoses();
  await page.waitForTimeout(600);
  const outerAfter = await readOuterPoses();
  outerAfter.forEach((pose, index) =>
    expect(pose).not.toBe(outerBefore[index]),
  );
  await page.screenshot({
    path: "test-results/choreography-fan-desktop.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(scene).toHaveAttribute("data-motion-phase", "still");
  await expect(scene).toHaveAttribute("data-motion-playing", "false");
  await expect(
    page.getByRole("button", { name: "Replay card animation" }),
  ).toHaveCount(0);
  const reduced = await canvas.screenshot();
  const outerReduced = await readOuterPoses();
  await page.waitForTimeout(250);
  expect(await readOuterPoses()).toEqual(outerReduced);
  expect((await canvas.screenshot()).equals(reduced)).toBe(true);
});

test("entry panels remain compact, readable and animated through both flows", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    for (const mode of [/Create Table/, /Join Room/]) {
      await page.getByRole("button", { name: mode }).click();
      const rail = page.getByRole("region", { name: "Deal in" });
      await expect(rail).toBeVisible();
      await expect(rail.locator("input")).toBeFocused();
      await expect(page.locator(".kinetic-scene")).toHaveAttribute(
        "data-motion-playing",
        "true",
      );
      const bounds = await rail.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      if (viewport.width > 760) {
        const artwork = await page.locator(".entry-artwork").boundingBox();
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(artwork!.x);
      }
      expect(
        await rail.evaluate((el) => getComputedStyle(el, "::before").content),
      ).toBe("none");
      await noHorizontalOverflow(page);
      await page.screenshot({
        path: `test-results/entry-panel-${mode.source.replaceAll(" ", "-")}-${viewport.width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Close deal-in rail" }).click();
    }
  }
});

test("classic entry centers the V3 sculpture between the original heading and bottom actions", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 760 },
    { width: 374, height: 788 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator(".kinetic-scene")).toHaveAttribute(
      "data-scene-status",
      "ready",
    );
    await noHorizontalOverflow(page);
    const layout = await page.evaluate(() => {
      const box = (selector: string) =>
        document.querySelector(selector)!.getBoundingClientRect().toJSON();
      return {
        brand: box(".launch-brand"),
        artwork: box(".entry-artwork"),
        actions: box(".deal-launch-actions"),
      };
    });
    expect(layout.artwork.top).toBeGreaterThanOrEqual(layout.brand.bottom);
    expect(layout.actions.top).toBeGreaterThanOrEqual(layout.artwork.bottom);
    expect(
      Math.abs(
        (layout.artwork.left + layout.artwork.right) / 2 - viewport.width / 2,
      ),
    ).toBeLessThan(1);
    if (viewport.height >= 760)
      expect(layout.actions.bottom).toBeLessThanOrEqual(viewport.height);
    await expect(page.locator(".launch-brand h1")).toHaveCSS(
      "text-transform",
      "none",
    );
    await expect(
      page.getByText("The table remembers. Bluff accordingly."),
    ).toBeVisible();
    const background = await page
      .locator(".entry-shell")
      .evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(background).toContain(
      viewport.width <= 760
        ? "kinetic-cardroom-launch-v2"
        : "kinetic-cardroom-launch-wide-v2",
    );
    if (viewport.width <= 1100) {
      for (const card of await page.locator(".entry-edge-card").all()) {
        await expect(card).toBeVisible();
        const rect = await card.boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width);
        expect(rect!.y).toBeGreaterThanOrEqual(layout.brand.bottom);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(layout.actions.top);
      }
    }
    await expect(page.getByText("THE SHORT VERSION")).toHaveCount(0);
    await expect(
      page.locator(".entry-playbook, .entry-intro, .entry-artwork-caption"),
    ).toHaveCount(0);
    console.log(
      `ENTRY_LAYOUT ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`,
    );
    await page.screenshot({
      path: `test-results/entry-poster-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }
});

test("high-DPI five-card scenes stay sharp across phone, desktop and Reduced Effects", async ({
  browser,
}) => {
  const table = await humanTable(browser, 3);
  try {
    await table.host
      .getByRole("button", { name: "Make Claim", exact: true })
      .click();
    await table.host
      .getByRole("button", { name: "Royal Flush", exact: true })
      .click();
    await table.host
      .locator(".claim-options button")
      .filter({ has: table.host.getByText("♠ Royal Flush", { exact: true }) })
      .click();
    const scene = table.guest.locator(
      '.living-table-scene[data-variant="game"]',
    );
    await expect(scene).toHaveAttribute("data-has-claim", "true");
    for (const viewport of [
      { width: 320, height: 760 },
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await table.guest.setViewportSize(viewport);
      await expect(scene).toHaveAttribute("data-scene-status", "ready");
      await expect
        .poll(() =>
          scene
            .locator("canvas")
            .evaluate(
              (canvas: HTMLCanvasElement) =>
                canvas.width / canvas.getBoundingClientRect().width,
            ),
        )
        .toBeGreaterThanOrEqual(1.74);
      await noHorizontalOverflow(table.guest);
      await table.guest.screenshot({
        path: `test-results/animation-five-card-${viewport.width}.png`,
        fullPage: true,
        scale: "css",
      });
    }
    await table.guest.setViewportSize({ width: 390, height: 844 });
    await table.guest.getByRole("button", { name: "Table settings" }).click();
    await table.guest.getByRole("button", { name: /Reduced effects/ }).click();
    await table.guest.getByRole("button", { name: "Close settings" }).click();
    await expect(scene).toHaveAttribute("data-quality", "reduced");
    await expect(scene).toHaveCSS("opacity", "1");
    const first = await scene.locator("canvas").screenshot();
    await table.guest.waitForTimeout(300);
    expect((await scene.locator("canvas").screenshot()).equals(first)).toBe(
      true,
    );
    await table.guest.screenshot({
      path: "test-results/animation-reduced-mobile.png",
      fullPage: true,
      scale: "css",
    });
    await table.guest
      .getByRole("button", { name: "BullShit", exact: true })
      .click();
    await expect(table.host.locator(".round-result-notice")).toBeVisible();
    await table.host.waitForTimeout(350);
    await table.host.screenshot({
      path: "test-results/animation-resolution-mobile.png",
      fullPage: true,
      scale: "css",
    });
    await expect(
      table.host.getByText("Round 2", { exact: true }),
    ).toBeVisible();
  } finally {
    await table.close();
  }
});

test("saved seats auto-restore, but another room's invite never restores them", async ({
  page,
}) => {
  const code = await createRoom(page);
  await expect(page.getByRole("button", { name: "Add Bot" })).toBeEnabled();
  await page.reload();
  await expect(page.locator("[data-room-code]")).toHaveText(code);
  await expect(page.getByRole("button", { name: "Add Bot" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /reconnect|refresh/i }),
  ).toHaveCount(0);
  const other = code === "ABC123" ? "XYZ789" : "ABC123";
  const socketRooms: string[] = [];
  page.on("websocket", (socket) =>
    socketRooms.push(new URL(socket.url()).pathname),
  );
  await page.goto(`/?room=${other}`);
  await expect(page.getByPlaceholder("Enter your name")).toBeVisible();
  await expect(page.locator("[data-room-code]")).toHaveCount(0);
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(page.getByPlaceholder("Enter room code")).toHaveValue(other);
  expect(socketRooms).toEqual([]);
});

test("transport open without session acceptance never enables table mutations", async ({
  page,
}) => {
  await page.routeWebSocket("**/api/rooms/**/live*", () => {
    /* Hold acceptance. */
  });
  await createRoom(page);
  await expect(page.getByRole("button", { name: "Add Bot" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "I am ready" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Start", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /reconnect|refresh/i }),
  ).toHaveCount(0);
});

test("dialogs trap keyboard focus, restore it, and browser Back opens only the safe leave dialog", async ({
  page,
}) => {
  await createRoom(page);
  const settings = page.getByRole("button", { name: "Table settings" });
  await settings.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  const controls = dialog.getByRole("button");
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  await page.getByRole("button", { name: "Invite friends" }).click();
  await page.evaluate(() => window.history.back());
  await expect(
    page.getByRole("heading", { name: "Do you want to leave the game?" }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(1);
  await expect(page.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Lobby" })).toBeVisible();
});

test("offline commands are disabled and reconnection restores the same seat automatically", async ({
  browser,
}) => {
  const table = await humanTable(browser);
  try {
    const { host, hostContext } = table;
    await host.getByRole("button", { name: "Make Claim", exact: true }).click();
    await expect(host.getByRole("dialog")).toBeVisible();
    await hostContext.setOffline(true);
    await host.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(host.getByRole("dialog")).toHaveCount(0);
    await expect(
      host.getByRole("button", { name: "Make Claim", exact: true }),
    ).toBeDisabled();
    await expect(
      host.getByRole("button", { name: /reconnect|refresh/i }),
    ).toHaveCount(0);
    await host.screenshot({
      path: "test-results/recovery-offline-mobile.png",
      fullPage: true,
    });
    await hostContext.setOffline(false);
    await host.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(
      host.getByRole("button", { name: "Make Claim", exact: true }),
    ).toBeEnabled();
    await expect(host.locator("[data-room-code]")).toHaveText(table.code);
    await expect(host.locator(".opponent-rail .player-seat")).toHaveCount(2);
  } finally {
    await table.close();
  }
});

test("resolution immediately deals; reveal is only opened via Last Round and does not replay on reload", async ({
  browser,
}) => {
  const table = await humanTable(browser);
  try {
    const { host, guest } = table;
    await host.getByRole("button", { name: "Make Claim", exact: true }).click();
    await host.getByRole("button", { name: "Pair", exact: true }).click();
    await host
      .getByRole("button", { name: "Pair of Twos", exact: true })
      .click();
    await guest
      .getByRole("button", { name: "Make Claim", exact: true })
      .click();
    await expect(guest.getByRole("dialog")).toBeVisible();
    // A new tab takes over the guest's seat and closes the old builder.
    const guestProtocol = await table.guestContext.newPage();
    await guestProtocol.goto("/");
    await expect(
      guest.getByRole("heading", { name: "BullShit Poker" }),
    ).toBeVisible();
    await expect(guest.getByRole("dialog")).toHaveCount(0);
    await expect(
      guestProtocol.getByRole("button", { name: "BullShit", exact: true }),
    ).toBeEnabled();
    await guestProtocol
      .getByRole("button", { name: "BullShit", exact: true })
      .click();
    await expect(host.getByText("Round 2", { exact: true })).toBeVisible();
    await expect(host.getByRole("dialog")).toHaveCount(0);
    await expect(
      host.getByRole("button", { name: /deal next|next round/i }),
    ).toHaveCount(0);
    await expect(
      host.getByRole("button", { name: "Last Round", exact: true }),
    ).toBeEnabled();
    await host.getByRole("button", { name: "Last Round", exact: true }).click();
    await expect(host.getByText("Truth Reveal", { exact: true })).toBeVisible();
    await expect(host.locator(".revealed-group")).toHaveCount(2);
    await host.getByRole("button", { name: "Close last round" }).click();
    await host.reload();
    await expect(host.getByText("Round 2", { exact: true })).toBeVisible();
    await expect(host.getByRole("dialog")).toHaveCount(0);
    await expect(host.locator(".round-result-notice")).toHaveCount(0);
    expect(
      await guestProtocol.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).playerId,
        seatKey,
      ),
    ).toBeTruthy();
    await guestProtocol.close();
  } finally {
    await table.close();
  }
});

test("reactions replace one another, expire three seconds after receipt, and never return on sync", async ({
  browser,
}) => {
  const table = await humanTable(browser);
  try {
    const { host, guest } = table;
    await guest.getByRole("button", { name: "React", exact: true }).click();
    await guest.locator(".reaction-dock button").nth(1).click();
    await expect(host.locator(".reaction-toast")).toBeVisible();
    const first = await host.locator(".reaction-toast").innerText();
    await host.waitForTimeout(1800);
    await host.getByRole("button", { name: "React", exact: true }).click();
    await host.locator(".reaction-dock button").nth(2).click();
    await expect(host.locator(".reaction-toast")).not.toHaveText(first);
    await host.waitForTimeout(1400);
    await expect(host.locator(".reaction-toast")).toBeVisible();
    await expect(host.locator(".reaction-toast")).toHaveCount(0, {
      timeout: 2300,
    });
    await host.reload();
    await expect(host.locator(".hand-dock")).toBeVisible();
    await expect(host.locator(".reaction-toast")).toHaveCount(0);
    await host.getByRole("button", { name: "Table settings" }).click();
    await host.getByRole("button", { name: "Close settings" }).click();
    await expect(host.locator(".reaction-toast")).toHaveCount(0);
  } finally {
    await table.close();
  }
});

test("WebGL rejection keeps entry, lobby, claims and leave playable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.includes("webgl")) return null;
      return Reflect.apply(original, this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator(".kinetic-scene")).toHaveAttribute(
    "data-scene-status",
    "fallback",
  );
  await createRoom(page);
  await expect(page.locator(".living-table-scene")).toHaveAttribute(
    "data-scene-status",
    "fallback",
  );
  await page.getByRole("button", { name: "Add Bot" }).click();
  await page.getByRole("button", { name: "I am ready" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Make Claim", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave game" }).click();
  await page.getByRole("button", { name: "Yes, leave" }).click();
  await expect(
    page.getByRole("heading", { name: "BullShit Poker" }),
  ).toBeVisible();
});

test("five-card hands, natural elimination, final reveal and rematch remain usable", async ({
  browser,
}) => {
  const table = await humanTable(browser);
  try {
    const { host, guest } = table;
    for (let round = 1; round <= 5; round += 1) {
      await expect(
        host.getByText(`Round ${round}`, { exact: true }),
      ).toBeVisible();
      // The starter rotates: on even rounds the guest opens before the host raises.
      if (round % 2 === 0) {
        await guest
          .getByRole("button", { name: "Make Claim", exact: true })
          .click();
        await guest.locator(".structured-submit").click();
      }
      const symbols = await host
        .locator(".card-row .playing-card strong")
        .allTextContents();
      // At most one unknown guest card exists; fewer than four known cards of
      // this suit makes this royal provably false, independent of the shuffle.
      const suit = ["♠", "♥", "♦", "♣"].find(
        (symbol) => symbols.filter((value) => value === symbol).length < 4,
      )!;
      await host
        .getByRole("button", { name: /^(Make Claim|Final Claim)$/ })
        .click();
      await host
        .getByRole("button", { name: "Royal Flush", exact: true })
        .click();
      await host
        .locator(".claim-options button")
        .filter({ has: host.getByText(`${suit} Royal Flush`, { exact: true }) })
        .click();
      await guest
        .getByRole("button", { name: "BullShit", exact: true })
        .click();
      if (round === 4) {
        await expect(host.locator(".card-row .playing-card")).toHaveCount(5);
        await host.setViewportSize({ width: 320, height: 760 });
        await noHorizontalOverflow(host);
        const cards = host.locator(".card-row .playing-card");
        const cardBounds = await cards.evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().toJSON()),
        );
        for (const bounds of cardBounds) {
          expect(bounds.left).toBeGreaterThanOrEqual(0);
          expect(bounds.right).toBeLessThanOrEqual(320);
        }
        await host.screenshot({
          path: "test-results/recovery-five-card-hand.png",
          fullPage: true,
        });
      }
    }
    await expect(
      host.getByRole("heading", { name: "Recovery Guest wins" }),
    ).toBeVisible();
    await expect(
      guest.getByRole("heading", { name: "Recovery Guest wins" }),
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Final Reveal", exact: true })
      .click();
    await expect(host.getByText("Truth Reveal", { exact: true })).toBeVisible();
    await expect(host.locator(".revealed-group")).toHaveCount(2);
    await expect(host.locator(".revealed-group .mini-card")).toHaveCount(6);
    await host.getByRole("button", { name: "Close last round" }).click();
    await host.screenshot({
      path: "test-results/recovery-natural-winner.png",
      fullPage: true,
    });
    await host.getByRole("button", { name: "Rematch", exact: true }).click();
    await expect(host.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(guest.getByRole("heading", { name: "Lobby" })).toBeVisible();
    await expect(
      host.getByRole("button", { name: "I am ready" }),
    ).toHaveAttribute("aria-pressed", "false");
  } finally {
    await table.close();
  }
});

test("WebGL context loss preserves the live HTML game", async ({ page }) => {
  await createRoom(page);
  const scene = page.locator(".living-table-scene");
  await expect(scene).toHaveAttribute("data-scene-status", "ready");
  await scene.locator("canvas").evaluate((canvas) => {
    const context = (canvas as HTMLCanvasElement).getContext("webgl2");
    const loss = context?.getExtension("WEBGL_lose_context");
    if (!loss)
      throw new Error("Browser cannot exercise actual WebGL context loss");
    loss.loseContext();
  });
  await expect(scene).toHaveAttribute("data-scene-status", "fallback");
  await page.getByRole("button", { name: "Add Bot" }).click();
  await expect(page.locator(".lobby-roster-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Table settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("mobile, landscape, tablet and desktop game zones remain separate with reachable overlays", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const table = await humanTable(browser);
  const viewports = [
    { width: 320, height: 760 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];
  try {
    for (const viewport of viewports) {
      await table.host.setViewportSize(viewport);
      await noHorizontalOverflow(table.host);
      const rects = await table.host.evaluate(() => {
        const keys = [".claim-zone", ".hand-dock", ".opponent-rail"];
        return keys.map((key) => ({
          key,
          rect: document.querySelector(key)!.getBoundingClientRect().toJSON(),
        }));
      });
      const arena = rects[0].rect;
      const hand = rects[1].rect;
      const overlapWidth =
        Math.min(hand.right, arena.right) - Math.max(hand.left, arena.left);
      const overlapHeight =
        Math.min(hand.bottom, arena.bottom) - Math.max(hand.top, arena.top);
      expect(overlapWidth <= 1 || overlapHeight <= 1).toBe(true);
      const scene = table.host.locator(
        '.living-table-scene[data-variant="game"]',
      );
      await expect(scene).toHaveAttribute("data-scene-framing", "contain");
      const bounds = JSON.parse(
        (await scene.getAttribute("data-scene-projected-bounds"))!,
      );
      for (const limit of Object.values(bounds) as number[])
        expect(Math.abs(limit)).toBeLessThanOrEqual(0.921);
      await table.host
        .getByRole("button", { name: "Make Claim", exact: true })
        .click();
      const dialog = table.host.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await table.host
        .getByRole("button", { name: "Royal Flush", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        table.host.getByRole("button", { name: "Royal Flush", exact: true }),
      ).toBeVisible();
      await noHorizontalOverflow(table.host);
      await table.host.screenshot({
        path: `test-results/recovery-claim-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      await table.host
        .getByRole("button", { name: "Close claim builder" })
        .click();
      await table.host.screenshot({
        path: `test-results/recovery-game-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
    }
  } finally {
    await table.close();
  }
});
