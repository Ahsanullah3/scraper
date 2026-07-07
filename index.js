const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function scrapeVimeoProfile(url) {
    console.log(`🚀 Starting extraction for: ${url}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        // ⚠️ TEMPORARILY DISABLED INTERCEPTION: 
        // Sometimes dropping certain assets breaks React hydration. 
        // Let's load the full page first to ensure it works, then optimize later.
        /*
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });
        */

        // 1. Changed to networkidle2 to wait for API calls and React to finish building the page
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // 2. Explicitly wait for the primary identifying element (the Name in the H1)
        console.log("⏳ Waiting for React DOM to render...");
        try {
            await page.waitForSelector('h1', { timeout: 10000 });
        } catch (timeoutErr) {
            console.log("⚠️ Timeout waiting for data to render. Taking a debug screenshot...");
            await page.screenshot({ path: 'debug-vimeo-failed-render.png', fullPage: true });
            console.log("📸 Screenshot saved as 'debug-vimeo-failed-render.png'. Check this file to see if you hit a Captcha.");
            // We don't throw here, we let it proceed so you can see exactly what 'N/A's it spits out.
        }

        const extractedData = await page.evaluate(() => {
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerText.trim() : "N/A";
            };

            const getAttr = (selector, attr) => {
                const el = document.querySelector(selector);
                return el ? el.getAttribute(attr) : "N/A";
            };

            const timeElement = document.querySelector('time');
            const uploadTimeRaw = timeElement ? timeElement.getAttribute('datetime') : "N/A";
            const uploadTimeRelative = timeElement ? timeElement.innerText.trim() : "N/A";
            
            const profileName = getText('h1'); 
            
            const emailNode = document.querySelector('a[href^="mailto:"]');
            const email = emailNode ? emailNode.getAttribute('href').replace('mailto:', '') : "N/A";

            const instagram = getAttr('a[href*="instagram.com"]', 'href');
            const facebook = getAttr('a[href*="facebook.com"]', 'href');
            const tiktok = getAttr('a[href*="tiktok.com"]', 'href');
            
            const allLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
            const websiteNode = allLinks.find(a => 
                !a.href.includes('vimeo.com') && 
                !a.href.includes('instagram.com') && 
                !a.href.includes('facebook.com') && 
                !a.href.includes('tiktok.com')
            );
            const website = websiteNode ? websiteNode.href : "N/A";

            const videoTitle = getText('[data-testid="content-card-title"]');
            const videoUrl = getAttr('[data-testid="content-card-title"]', 'href');
            const videoDate = getText('[data-testid="content-card-subtitle"]');

            return {
                profileName,
                uploadTimeRaw,
                uploadTimeRelative,
                email,
                website,
                socials: {
                    instagram,
                    facebook,
                    tiktok
                },
                videoDetails: {
                    titleOrAddress: videoTitle,
                    date: videoDate,
                    url: videoUrl
                }
            };
        });

        console.log("✅ Extraction Complete:");
        console.dir(extractedData, { depth: null });

        return extractedData;

    } catch (error) {
        console.error(`🛑 Fatal Error: ${error.message}`);
    } finally {
        await browser.close();
    }
}

scrapeVimeoProfile('https://vimeo.com/user68733986');
