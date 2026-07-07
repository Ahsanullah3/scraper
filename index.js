const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth plugin
puppeteer.use(StealthPlugin());

async function scrapeVimeoProfile(url) {
    console.log(`🚀 Starting extraction for: ${url}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        // Optimize page load by blocking unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Execute extraction inside the browser context
        const extractedData = await page.evaluate(() => {
            
            // Helper function to safely get text
            const getText = (selector) => {
                const el = document.querySelector(selector);
                return el ? el.innerText.trim() : "N/A";
            };

            // Helper function to safely get an attribute
            const getAttr = (selector, attr) => {
                const el = document.querySelector(selector);
                return el ? el.getAttribute(attr) : "N/A";
            };

            // 1. Uploader Details & Time
            const timeElement = document.querySelector('time');
            const uploadTimeRaw = timeElement ? timeElement.getAttribute('datetime') : "N/A";
            const uploadTimeRelative = timeElement ? timeElement.innerText.trim() : "N/A";
            
            // Assuming the h1 is always the profile name based on the HTML structure
            const profileName = getText('h1'); 
            
            // 2. Contact & Socials
            // Look for the specific mailto link
            const emailNode = document.querySelector('a[href^="mailto:"]');
            const email = emailNode ? emailNode.getAttribute('href').replace('mailto:', '') : "N/A";

            // Find social links by matching href substrings
            const instagram = getAttr('a[href*="instagram.com"]', 'href');
            const facebook = getAttr('a[href*="facebook.com"]', 'href');
            const tiktok = getAttr('a[href*="tiktok.com"]', 'href');
            
            // Find the website (a link that contains http but isn't a known social network or vimeo)
            const allLinks = Array.from(document.querySelectorAll('a[href^="http"]'));
            const websiteNode = allLinks.find(a => 
                !a.href.includes('vimeo.com') && 
                !a.href.includes('instagram.com') && 
                !a.href.includes('facebook.com') && 
                !a.href.includes('tiktok.com')
            );
            const website = websiteNode ? websiteNode.href : "N/A";

            // 3. Video / Address Details using reliable data-testids
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

        console.log("✅ Extraction Successful:");
        console.dir(extractedData, { depth: null });

        return extractedData;

    } catch (error) {
        console.error(`🛑 Error during scraping: ${error.message}`);
    } finally {
        await browser.close();
    }
}

// Execute the function (Replace with your actual target URL)
scrapeVimeoProfile('https://vimeo.com/user68733986');
