const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// =========================================================
// 1. EXPONENTIAL BACKOFF (Google API)
// =========================================================
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function saveWithRetry(sheet, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await sheet.saveUpdatedCells();
            return; 
        } catch (error) {
            if (i === retries - 1) {
                console.error("❌ Max retries reached. Google API remains unavailable.");
                throw error;
            }
            const waitTime = (2 ** i) * 1000;
            console.log(`⚠️ Google API 500/Timeout. Retrying in ${2 ** i} seconds...`);
            await delay(waitTime);
        }
    }
}

// =========================================================
// 2. CORE SCRAPER ENGINE (Two-Step Routing)
// =========================================================
async function runScraper() {
    console.log("🚀 Starting Vimeo Stealth Scraper V11 (Two-Step Profile Extraction)...");

    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    const serviceAccountAuth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    // Ensure enough columns for Vimeo data (Adjust as needed for your layout)
    if (sheet.columnCount < 20) {
        await sheet.resize({ rowCount: sheet.rowCount, columnCount: 20 });
    }

    await sheet.loadCells();

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    let scrapeCount = 0;
    let rowsRemaining = false;
    const FLUSH_BATCH_SIZE = 10; 
    let stagedCellsToSave = [];

    // 3. Row Execution Loop
    for (let rowIndex = 1; rowIndex < sheet.rowCount; rowIndex++) {
        const originalUrl = sheet.getCell(rowIndex, 0).value; // Assuming Col A has the Video URL
        const status = sheet.getCell(rowIndex, 19).value || ""; // Using Col T (index 19) for Status

        if (!originalUrl) continue; 
        if (!originalUrl.includes("vimeo.com") || status.includes("✅")) continue; 

        if (scrapeCount >= 30) {
            console.log("🛑 Reached 30 rows. Shutting down to rotate environment...");
            rowsRemaining = true;
            break;
        }

        const actualRowNumber = rowIndex + 1;
        console.log(`\n🕵️ Scraping Row ${actualRowNumber}: ${originalUrl}`);

        const page = await browser.newPage();

        try {
            // Spoof UA to bypass basic bot checks
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920, height: 1080 });

            // ---------------------------------------------------------
            // STEP 1: VIDEO PAGE (Extract Time & Profile Link)
            // ---------------------------------------------------------
            console.log(`   -> Loading Video Page...`);
            await page.goto(originalUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            const videoData = await page.evaluate(() => {
                const timeEl = document.querySelector('time');
                const uploaderLink = document.querySelector('[data-testid="uploader-details"] a');
                
                // Get the text inside the anchor link or fallback to alt tag
                const uploaderNameEl = document.querySelector('[data-testid="uploader-details"] span.chakra-text') 
                                    || document.querySelector('[data-testid="uploader-details"] img');

                return {
                    uploadTime: timeEl ? timeEl.getAttribute('datetime') || timeEl.innerText.trim() : "N/A",
                    profileUrl: uploaderLink ? uploaderLink.href : null,
                    profileName: uploaderNameEl ? (uploaderNameEl.innerText || uploaderNameEl.alt) : "N/A"
                };
            });

            if (!videoData.profileUrl) {
                throw new Error("Could not find uploader profile URL on the video page.");
            }

            console.log(`   ✔️ Found Profile: ${videoData.profileName} | Uploaded: ${videoData.uploadTime}`);

            // ---------------------------------------------------------
            // STEP 2: PROFILE PAGE (Extract Contact & Socials)
            // ---------------------------------------------------------
            console.log(`   -> Navigating to Profile: ${videoData.profileUrl}`);
            await page.goto(videoData.profileUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Scroll to hydrate React components (lazy-loaded socials)
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const timer = setInterval(() => {
                        window.scrollBy(0, 200);
                        totalHeight += 200;
                        if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            await delay(1500); // Buffer for UI to settle

            const profileData = await page.evaluate(() => {
                const getAttr = (sel, attr) => document.querySelector(sel)?.getAttribute(attr) || "N/A";
                const getText = (sel) => document.querySelector(sel)?.innerText.trim() || "N/A";

                const emailNode = document.querySelector('a[href^="mailto:"]');
                const email = emailNode ? emailNode.getAttribute('href').replace('mailto:', '') : "N/A";

                const allLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
                const websiteNode = allLinks.find(a => 
                    !a.href.includes('vimeo.com') && !a.href.includes('instagram.com') && 
                    !a.href.includes('facebook.com') && !a.href.includes('tiktok.com')
                );

                return {
                    email: email,
                    website: websiteNode ? websiteNode.href : "N/A",
                    instagram: getAttr('a[href*="instagram.com"]', 'href'),
                    facebook: getAttr('a[href*="facebook.com"]', 'href'),
                    tiktok: getAttr('a[href*="tiktok.com"]', 'href'),
                    addressTitle: getText('[data-testid="content-card-title"]'),
                    addressDate: getText('[data-testid="content-card-subtitle"]')
                };
            });

            // ---------------------------------------------------------
            // 4. SAVE TO MEMORY MAP (Adjust Column Indices as needed)
            // ---------------------------------------------------------
            sheet.getCell(rowIndex, 9).value = videoData.profileName;         // Col J
            sheet.getCell(rowIndex, 10).value = videoData.profileUrl;         // Col K
            sheet.getCell(rowIndex, 11).value = videoData.uploadTime;         // Col L
            sheet.getCell(rowIndex, 12).value = profileData.email;            // Col M
            sheet.getCell(rowIndex, 13).value = profileData.website;          // Col N
            sheet.getCell(rowIndex, 14).value = profileData.instagram;        // Col O
            sheet.getCell(rowIndex, 15).value = profileData.facebook;         // Col P
            sheet.getCell(rowIndex, 16).value = profileData.tiktok;           // Col Q
            sheet.getCell(rowIndex, 17).value = profileData.addressTitle;     // Col R
            sheet.getCell(rowIndex, 18).value = profileData.addressDate;      // Col S
            sheet.getCell(rowIndex, 19).value = "✅ SUCCESS";                 // Col T (Status)

            stagedCellsToSave.push(rowIndex);
            scrapeCount++;
            console.log(`   ✔️ Data staged successfully for Row ${actualRowNumber}.`);

        } catch (e) {
            console.error(`   🛑 Error on Row ${actualRowNumber}: ${e.message}`);
            sheet.getCell(rowIndex, 19).value = "🛑 Error: " + e.message;
            stagedCellsToSave.push(rowIndex);
        } finally {
            // CRITICAL: Close the page inside the loop to free memory before the next row
            if (page) await page.close();
        }

        // 5. BATCH WRITING
        if (stagedCellsToSave.length >= FLUSH_BATCH_SIZE) {
            console.log(`📦 Flashing batch of ${stagedCellsToSave.length} records to Google Sheets...`);
            await saveWithRetry(sheet);
            stagedCellsToSave = []; 
        }
    }

    if (stagedCellsToSave.length > 0) {
        console.log(`📦 Flashing final ${stagedCellsToSave.length} trailing records...`);
        await saveWithRetry(sheet);
    }

    await browser.close();

    // 6. GITHUB ACTIONS CASCADE BRIDGE
    if (process.env.GITHUB_OUTPUT) {
        if (rowsRemaining) {
            fs.appendFileSync(process.env.GITHUB_OUTPUT, "has_more=true\n");
            console.log("🔄 Remaining links found. Relaying trigger token to runner pipeline...");
        } else {
            fs.appendFileSync(process.env.GITHUB_OUTPUT, "has_more=false\n");
            console.log("🎉 Entire sheet processing execution completed!");
        }
    }
}

runScraper();
