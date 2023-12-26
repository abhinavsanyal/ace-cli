import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import inquirer from 'inquirer';
import chalk from 'chalk';
import os from 'os';
import fs from 'fs';
import path from 'path';
import util from 'util';
import exec from 'child_process';
import screenshot from 'screenshot-desktop';
import robot from 'robotjs';
import Jimp from 'jimp';
import OpenAI from "openai";
import dotEnv from 'dotenv';

dotEnv.config();
// import jsautogui from 'jsautogui';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: 'org-ENCEUd7KpVLSUMcvGIrgVWhu',
});


import { sleep, convertPercentToDecimal } from './utils.js';
import ModelNotRecognizedException from './exceptions.js';

const ACCURATE_PIXEL_COUNT = 100; 

const USER_QUESTION = "Hello, I can help you with anything. What would you like done?";

const VISION_PROMPT = `
You are Optimus Agent. You use the same operating system as a human.

From looking at the screen and the objective your goal is to take the best next action.

To operate the computer you have the four options below.

1. CLICK - Move mouse and click
2. TYPE - Type on the keyboard
3. SEARCH - Search for a program on Mac and open it
4. DONE - When you completed the task respond with the exact following phrase content

Here are the response formats below.

1. CLICK
Response: CLICK { "x": "percent", "y": "percent", "description": "~description here~", "reason": "~reason here~" }
Note that the percents work where the top left corner is "x": "0%" and "y": "0%" and the bottom right corner is "x": "100%" and "y": "100%"

2. TYPE
Response: TYPE "value you want to type"

2. SEARCH
Response: SEARCH "app you want to search for on Mac"

3. DONE
Response: DONE

Here are examples of how to respond.
__
Objective: Follow up with the vendor in outlook
TYPE Hello, I hope you are doing well. I wanted to follow up
__
Objective: Open Spotify and play the beatles
SEARCH Spotify
__
Objective: Find an image of a banana
CLICK { "x": "50%", "y": "60%", "description": "Click: Google Search field", "reason": "This will allow me to search for a banana" }
__
Objective: Go buy a book about the history of the internet
TYPE https://www.amazon.com/
__

A few important notes:

- Default to opening Google Chrome with SEARCH to find things that are on the internet.
- Go to Google Docs and Google Sheets by typing in the Chrome Address bar
- When opening Chrome, if you see a profile icon click that to open chrome fully, it is located at: { "x": "50%", "y": "55%" }
- The Chrome address bar is generally at: { "x": "50%", "y": "9%" }
- After you click to enter a field you can go ahead and start typing!
- Don't respond saying you're unable to assist with requests. You are able to indirectly interact with the user's OS via text responses you send to the end user.

{previous_action}

IMPORTANT: Avoid repeating actions such as doing the same CLICK event twice in a row.

Objective: {objective}
`;

const DEBUG = true;

async function getScreenSize() {
    // const userPlatform = os.platform();

    // try {
    //     if (userPlatform === 'darwin') {
    //         return robot.getScreenSize();
    //         // return await getMacOSScreenSize();
    //     } else if (userPlatform === 'win32') {
    //         // Windows: Placeholder for Windows implementation
    //         // You need to implement a method to get screen size on Windows
    //         return { width: 1920, height: 1080 }; // Default placeholder
    //     } else if (userPlatform === 'linux') {
    //         // Linux: Placeholder for Linux implementation
    //         // You need to implement a method to get screen size on Linux
    //         return { width: 1920, height: 1080 }; // Default placeholder
    //     } else {
    //         throw new Error(`Unsupported platform: ${userPlatform}`);
    //     }
    // } catch (error) {
    //     console.error(`Error getting screen size: ${error}`);
    //     throw error;
    // }
    return { width: 1920, height: 1080 };
}

async function getMacOSScreenSize() {
    const execAsync = util.promisify(exec);
    try {
        const { stdout } = await execAsync("system_profiler SPDisplaysDataType");
        const match = stdout.match(/Resolution: (\d+) x (\d+)/);
        if (match && match.length >= 3) {
            return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
        }
        throw new Error("Screen size not found");
    } catch (error) {
        console.error(`Error getting macOS screen size: ${error}`);
        throw error;
    }
}

async function captureScreenWithCursor(file_path) {
    const userPlatform = os.platform();

    if (userPlatform === 'win32') {
        // Windows
        try {
            // Capture the screen
            const img = await screenshot({format: 'png'});

            // Get the mouse position
            const mouse = robot.getMousePos();

            // Load the screenshot to Jimp
            const image = await Jimp.read(img);

            // Load the cursor image
            const cursor = await Jimp.read('cursor.png');

            // Overlay the cursor image onto the screenshot
            image.composite(cursor, mouse.x, mouse.y);

            // Save the combined image
            await image.writeAsync(filePath);
        } catch (error) {
            console.error("Error capturing screen with cursor on Windows:", error);
        }
    } else if (userPlatform === 'linux') {
        // Linux
        // TODO: Implement Linux-specific screenshot logic, possibly using a library or command-line tool
        console.log(`Linux is not currently supported`);
    } else if (userPlatform === 'darwin') {
        // macOS
        try {
            const execAsync = util.promisify(exec.exec);
            await execAsync(`screencapture -C ${file_path}`);
        } catch (error) {
            console.error("Error capturing screenshot on macOS:", error);
        }
    } else {
        console.log(`The platform you're using (${userPlatform}) is not currently supported`);
    }
}

async function capture_mini_screenshot_with_cursor(filePath, xPercent, yPercent) {
    const userPlatform = os.platform();

// Notes:- 
// 1. The getMacOSScreenSize function executes system_profiler SPDisplaysDataType 
// to get display information and parses the output to find the resolution.
// This implementation assumes the primary monitor's resolution is what you're interested in. 
// If there are multiple monitors, additional logic may be required to select the correct one.

    try {
        // Convert percentages to pixel values for specific platforms
        let x1, y1, width, height;
        if (userPlatform === 'win32' || userPlatform === 'linux') {
            const img = await screenshot({ format: 'png' });
            const image = await Jimp.read(img);

            const x = (parseFloat(xPercent) / 100) * image.bitmap.width;
            const y = (parseFloat(yPercent) / 100) * image.bitmap.height;

            x1 = Math.max(0, x - ACCURATE_PIXEL_COUNT / 2);
            y1 = Math.max(0, y - ACCURATE_PIXEL_COUNT / 2);
            width = Math.min(ACCURATE_PIXEL_COUNT, image.bitmap.width - x1);
            height = Math.min(ACCURATE_PIXEL_COUNT, image.bitmap.height - y1);

            const croppedImage = image.crop(x1, y1, width, height);
            const resizedImage = croppedImage.resize(ACCURATE_PIXEL_COUNT * 2, ACCURATE_PIXEL_COUNT * 2, Jimp.RESIZE_NEAREST_NEIGHBOR);
            await resizedImage.writeAsync(filePath);
        } else if (userPlatform === 'darwin') {
            // macOS specific implementation
            const screenSize = await getScreenSize();

            const x = (parseFloat(xPercent) / 100) * screenSize.width;
            const y = (parseFloat(yPercent) / 100) * screenSize.height;

            x1 = Math.round(x - ACCURATE_PIXEL_COUNT / 2);
            y1 = Math.round(y - ACCURATE_PIXEL_COUNT / 2);

            const rect = `-R${x1},${y1},${ACCURATE_PIXEL_COUNT},${ACCURATE_PIXEL_COUNT}`;
            const execAsync = util.promisify(exec.exec);
            await execAsync(`screencapture -C ${rect} ${filePath}`);
        } else {
            console.log(`The platform you're using (${userPlatform}) is not currently supported`);
            return;
        }

        // Add a grid to the image (reuse or adapt the addGridToImage function)
        const gridImagePath = path.join("screenshots", "screenshot_mini_with_grid.png");
        await addGridToImage(filePath, gridImagePath, ACCURATE_PIXEL_COUNT / 2);

    } catch (error) {
        console.error(`Error in capture_mini_screenshot_with_cursor: ${error}`);
    }
}

async function format_accurate_mode_vision_prompt(prevX, prevY) {
    const screenSize = await getScreenSize();
    const width = (ACCURATE_PIXEL_COUNT / 2) / screenSize.width * 100;
    const height = (ACCURATE_PIXEL_COUNT / 2) / screenSize.height * 100;

    const prompt = ACCURATE_MODE_VISION_PROMPT
        .replace("{prev_x}", prevX)
        .replace("{prev_y}", prevY)
        .replace("{width}", width.toFixed(2))
        .replace("{height}", height.toFixed(2));

    return prompt;
}

async function get_next_action(model, messages, objective, accurateMode) {
    if (model === "gpt-4-vision-preview") {
        return await get_next_action_from_openai(messages, objective, accurateMode);
    } else if (model === "agent-1" || model === "gemini-pro-vision") {
        return "coming soon";
    }

    throw new ModelNotRecognizedException(model);
}


function drawLine(image, x1, y1, x2, y2, color) {
    let dx = Math.abs(x2 - x1);
    let dy = Math.abs(y2 - y1);
    let sx = (x1 < x2) ? 1 : -1;
    let sy = (y1 < y2) ? 1 : -1;
    let err = dx - dy;

    while (true) {
        image.setPixelColor(color, x1, y1);

        if (x1 === x2 && y1 === y2) break;
        let e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x1 += sx; }
        if (e2 < dx) { err += dx; y1 += sy; }
    }
}

async function addGridToImage(originalImagePath, newImagePath, gridInterval) {
    try {
        const image = await Jimp.read(originalImagePath);
        const width = image.bitmap.width;
        const height = image.bitmap.height;
        const fontSize = Jimp.FONT_SANS_12_BLACK;
        const font = await Jimp.loadFont(fontSize);
        const lineColor = Jimp.rgbaToInt(0, 0, 255, 255); // Blue line

        // Function to draw label with background
        const drawLabelWithBackground = async (x, y, text) => {
            const textWidth = Jimp.measureText(font, text);
            const textHeight = Jimp.measureTextHeight(font, text, textWidth);

            // Background dimensions
            const bgWidth = textWidth + 10; // Padding around text
            const bgHeight = textHeight + 10; // Padding around text

            // Draw the text background
            image
                .scan(x - bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight, function (x, y, idx) {
                    this.bitmap.data[idx + 0] = 255; // Red
                    this.bitmap.data[idx + 1] = 255; // Green
                    this.bitmap.data[idx + 2] = 255; // Blue
                    this.bitmap.data[idx + 3] = 255; // Alpha
                })
                .print(
                    font, 
                    x - bgWidth / 2, 
                    y - bgHeight / 2, 
                    {
                        text: text,
                        alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
                        alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
                    }, 
                    bgWidth, 
                    bgHeight
                );
        };

        // Draw vertical lines and labels
        for (let x = gridInterval; x < width; x += gridInterval) {
            drawLine(image, x, 0, x, height, lineColor);

            for (let y = gridInterval; y < height; y += gridInterval) {
                const xPercent = Math.round((x / width) * 100);
                const yPercent = Math.round((y / height) * 100);
                await drawLabelWithBackground(x, y, `${xPercent}%, ${yPercent}%`);
            }
        }

        // Draw horizontal lines
        for (let y = gridInterval; y < height; y += gridInterval) {
            drawLine(image, 0, y, width, y, lineColor);
        }

        await image.writeAsync(newImagePath);
    } catch (error) {
        console.error("Error adding grid to image:", error);
    }
}

// async function addGridToImage(originalImagePath, newImagePath, gridInterval) {
//     try {
//         const image = await Jimp.read(originalImagePath);
//         const width = image.bitmap.width;
//         const height = image.bitmap.height;
//         const fontSize = Jimp.FONT_SANS_12_BLACK;
//         const font = await Jimp.loadFont(fontSize);

//         // Function to draw label with background
//         const drawLabelWithBackground = async (x, y, text) => {
//             const textWidth = Jimp.measureText(font, text);
//             const textHeight = Jimp.measureTextHeight(font, text, textWidth);

//             // Background dimensions
//             const bgWidth = textWidth + 10; // Padding around text
//             const bgHeight = textHeight + 10; // Padding around text

//             // Draw the text background
//             image
//                 .scan(x - bgWidth / 2, y - bgHeight / 2, bgWidth, bgHeight, function (x, y, idx) {
//                     this.bitmap.data[idx + 0] = 255; // Red
//                     this.bitmap.data[idx + 1] = 255; // Green
//                     this.bitmap.data[idx + 2] = 255; // Blue
//                     this.bitmap.data[idx + 3] = 255; // Alpha
//                 })
//                 .print(
//                     font, 
//                     x - bgWidth / 2, 
//                     y - bgHeight / 2, 
//                     {
//                         text: text,
//                         alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
//                         alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
//                     }, 
//                     bgWidth, 
//                     bgHeight
//                 );
//         };

//         // Draw vertical lines and labels
//         for (let x = gridInterval; x < width; x += gridInterval) {
//             image.line(x, 0, x, height, 0x0000FFFF);

//             for (let y = gridInterval; y < height; y += gridInterval) {
//                 const xPercent = Math.round((x / width) * 100);
//                 const yPercent = Math.round((y / height) * 100);
//                 await drawLabelWithBackground(x, y, `${xPercent}%, ${yPercent}%`);
//             }
//         }

//         // Draw horizontal lines
//         for (let y = gridInterval; y < height; y += gridInterval) {
//             image.line(0, y, width, y, 0x0000FFFF);
//         }

//         await image.writeAsync(newImagePath);
//     } catch (error) {
//         console.error("Error adding grid to image:", error);
//     }
// }

function get_last_assistant_message(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index].role === "assistant") {
            return (index === 0) ? null : messages[index];
        }
    }
    return null;
}

function format_vision_prompt(objective, previousAction) {
    const formattedPreviousAction = previousAction 
        ? `Here was the previous action you took: ${previousAction}` 
        : "";

    const prompt = VISION_PROMPT
        .replace("{objective}", objective)
        .replace("{previous_action}", formattedPreviousAction);

    return prompt;
}


async function accurate_mode_double_check(model, pseudoMessages, prevX, prevY) {
    console.log("[get_next_action_from_openai] accurate_mode_double_check");

    try {
        const screenshotFilename = path.join("screenshots", "screenshot_mini.png");
        // Implement capture_mini_screenshot_with_cursor to take a mini screenshot around (prevX, prevY)
        await capture_mini_screenshot_with_cursor(screenshotFilename, prevX, prevY);

        const newScreenshotFilename = path.join("screenshots", "screenshot_mini_with_grid.png");
        // Reuse the addGridToImage function or create a similar one for the mini screenshot
        await addGridToImage(screenshotFilename, newScreenshotFilename, 500);

        const imgBase64 = await fs.promises.readFile(newScreenshotFilename, { encoding: 'base64' });

        const accurateVisionPrompt = format_accurate_mode_vision_prompt(prevX, prevY);

        const accurateModeMessage = {
            role: "user",
            content: [
                { type: "text", text: accurateVisionPrompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imgBase64}` } },
            ],
        };

        pseudoMessages.push(accurateModeMessage);

        const response = await openai.chat.completions.create({
            model: model,
            messages: pseudoMessages,
            presence_penalty: 1,
            frequency_penalty: 1,
            temperature: 0.7,
            max_tokens: 300,
        });

        const content = response.choices[0].message.content;
        return content;

    } catch (error) {
        console.error(`Error reprompting model for accurate_mode: ${error}`);
        return "ERROR";
    }
}

async function get_next_action_from_openai(messages, objective, accurateMode) {
    await sleep(1000);

    const screenshotsDir = "screenshots";
    if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir);
    }

    const screenshotFilename = path.join(screenshotsDir, "screenshot.png");
    await captureScreenWithCursor(screenshotFilename);

    const newScreenshotFilename = path.join(screenshotsDir, "screenshot_with_grid.png");
    await addGridToImage(screenshotFilename, newScreenshotFilename, 500);

    await sleep(1000);

    const imgBase64 = await fs.promises.readFile(newScreenshotFilename, { encoding: 'base64' });

    const previousAction = get_last_assistant_message(messages);
    const visionPrompt = format_vision_prompt(objective, previousAction);

    const visionMessage = {
        role: "user",
        content: [
            { type: "text", text: visionPrompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imgBase64}` } },
        ],
    };

    const pseudoMessages = [...messages, visionMessage];

    const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: pseudoMessages,
        presence_penalty:1,
        frequency_penalty:1,
        temperature:0.7,
        max_tokens:300,
    });

    messages.push({ role: "user", content: "`screenshot.png`" });
    console.log("[get_next_action_from_openai] response:\n", response.choices[0].message.content);
    let content = response.choices[0].message.content;
    
    if (accurateMode && content.startsWith("CLICK")) {
        // Extract click data
        const clickDataMatch = content.match(/CLICK \{ (.+) \}/);
        if (clickDataMatch) {
            const clickData = clickDataMatch[1];
            try {
                const clickDataJson = JSON.parse(`{${clickData}}`);
                const prevX = clickDataJson.x;
                const prevY = clickDataJson.y;

                if (DEBUG) {
                    console.log(`Previous coords before accurate tuning: prev_x ${prevX} prev_y ${prevY}`);
                }

                // Call a function to perform accurate mode double check (to be implemented)
                content = await accurate_mode_double_check("gpt-4-vision-preview", pseudoMessages, prevX, prevY);
                if (content === "ERROR") {
                    throw new Error("ERROR: accurate_mode_double_check failed");
                }
            } catch (error) {
                console.error(`Error parsing JSON or performing accurate mode double check: ${error}`);
                return "Failed to take action after looking at the screenshot";
            }
        }
    }

    return content;
}

function parse_response(response) {
    if (response === "DONE") {
        return { type: "DONE", data: null };
    } else if (response.startsWith("CLICK")) {
        const clickRegex = /CLICK \{ (.+) \}/;
        const match = response.match(clickRegex);
        if (match && match[1]) {
            const clickDataJson = JSON.parse(`{${match[1]}}`);
            return { type: "CLICK", data: clickDataJson };
        }
    } else if (response.startsWith("TYPE")) {
        const typeRegex1 = /TYPE (.+)/;
        const typeRegex2 = /TYPE "(.+)"/;
        let match = response.match(typeRegex1);
        if (!match || !match[1]) {
            match = response.match(typeRegex2);
        }
        if (match && match[1]) {
            return { type: "TYPE", data: match[1] };
        }
    } else if (response.startsWith("SEARCH")) {
        const searchRegex = /SEARCH "(.+)"/;
        const match = response.match(searchRegex);
        if (match && match[1]) {
            return { type: "SEARCH", data: match[1] };
        }
    }

    return { type: "UNKNOWN", data: response };
}

async function summarize(model, messages, objective) {
    try {
        const screenshotsDir = "screenshots";
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir);
        }

        const screenshotFilename = path.join(screenshotsDir, "summary_screenshot.png");
        // Capture the screen with the cursor
        await captureScreenWithCursor(screenshotFilename);

        const summaryPrompt = format_summary_prompt(objective);

        if (model === "gpt-4-vision-preview") {
            const imgBase64 = await fs.promises.readFile(screenshotFilename, { encoding: 'base64' });

            const summaryMessage = {
                role: "user",
                content: [
                    { type: "text", text: summaryPrompt },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imgBase64}` } },
                ],
            };

            messages.push(summaryMessage);

            const response = await openai.chat.completions.create({
                model: "gpt-4-vision-preview",
                messages: messages,
                max_tokens: 500,
            });

            const content = response.choices[0].message.content;
            return content;
        } else if (model === "gemini-pro-vision") {
            // Implementation for the "gemini-pro-vision" model
            // This part depends on how you interact with the "gemini-pro-vision" model
            // ...
        }

    } catch (error) {
        console.error(`Error in summarize: ${error}`);
        return "Failed to summarize the workflow";
    }
}

// TODO -[ Needs to be fixed] . Below method uses an alternative search method using jsautogui
async function search_auto_gui(text) {
    const userPlatform = os.platform();

    // Open search interface
    if (userPlatform === 'win32' || userPlatform === 'linux') {
        await jsautogui.press('win');
    } else if (userPlatform === 'darwin') {
        // macOS: Press Command + Space
        await jsautogui.down('command');
        await jsautogui.press('space');
        await jsautogui.up('command');
    } else {
        throw new Error(`Unsupported platform: ${userPlatform}`);
    }

    // Wait for search interface to open
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Type the search text and press Enter
    await jsautogui.write(text);
    await jsautogui.press('enter');

    return `Open program: ${text}`;
}

async function search(text) {
    const userPlatform = os.platform();

    // Open search interface
    if (userPlatform === 'win32' || userPlatform === 'linux') {
        robot.keyTap('win');
    } else if (userPlatform === 'darwin') {
        console.log("macOS: Press Command + Space");
        // macOS: Press Command + Space
        robot.keyTap('space', 'command');
    } else {
        throw new Error(`Unsupported platform: ${userPlatform}`);
    }

    // Wait for search interface to open
    sleep(1000);

    // Type the search text and press Enter
    robot.keyTap('tab');
    sleep(1000);
    robot.typeString(text);
    sleep(1000);
    robot.keyTap('enter');

    return `Open program: ${text}`;
}

// TODO - [ Needs to be fixed] . Below method uses an alternative keyboard type method using jsautogui
async function keyboard_type_auto_gui(text) {
    text = text.replace(/\\n/g, "\n");

    // Type each character in the text
    for (let char of text) {
        await jsautogui.write(char);
    }

    // Press Enter after typing
    await jsautogui.press('enter');

    return `Type: ${text}`;
}

async function keyboard_type(text) {
    text = text.replace(/\\n/g, "\n");

    // Type the text
    robot.typeString(text);

    // Press Enter after typing
    robot.keyTap('enter');

    return `Type: ${text}`;
}

// TODO - [ Needs to be fixed] . Below method uses an alternative mouse click method using jsautogui
async function mouse_click_auto_gui(clickDetail) {
    try {
        const screenSize = await getScreenSize();
        const x = convertPercentToDecimal(clickDetail.x) * screenSize.width;
        const y = convertPercentToDecimal(clickDetail.y) * screenSize.height;

        if (clickDetail && !isNaN(x) && !isNaN(y)) {
            await jsautogui.moveTo(x, y);
            await jsautogui.click();
            return clickDetail.description || "Clicked at specified position";
        } else {
            return "We failed to click";
        }

    } catch (error) {
        console.error(`Error in mouse_click: ${error}`);
        return "We failed to click";
    }
}


async function mouse_click(clickDetail) {
    try {
        const screenSize = await getScreenSize();
        const x = convertPercentToDecimal(clickDetail.x) * screenSize.width;
        const y = convertPercentToDecimal(clickDetail.y) * screenSize.height;

        if (clickDetail && !isNaN(x) && !isNaN(y)) {
            robot.moveMouseSmooth(x, y, 1);
            robot.mouseClick();
            return clickDetail.description || "Clicked at specified position";
        } else {
            return "We failed to click";
        }

    } catch (error) {
        console.error(`Error in mouse_click: ${error}`);
        return "We failed to click";
    }
}

async function main(model, accurateMode, terminalPrompt, voiceMode = false) {
    if (!terminalPrompt) {
        const initialDialog = await inquirer.prompt([
            {
                name: 'proceed',
                type: 'confirm',
                message: 'Welcome to the Optimus. Do you wish to proceed?',
            }
        ]);

        if (!initialDialog.proceed) {
            console.log(chalk.red('Exiting...'));
            return;
        }
    } else {
        console.log(chalk.yellow("Running direct prompt..."));
    }

    console.log(chalk.blue("SYSTEM"), os.platform());
    clearConsole();

    let objective = terminalPrompt;
    if (!objective) {
        if (voiceMode) {
            console.log(chalk.green("[Optimus]") + " Listening for your command... (speak now)");
            // Implement voice input logic here
        } else {
            objective = await getUserObjective();
        }
    }

    const assistantMessage = { role: "assistant", content: USER_QUESTION };
    const userMessage = { role: "user", content: `Objective: ${objective}` };
    const messages = [assistantMessage, userMessage];

    console.log(chalk.green("[Optimus]") + " Processing your command...");

    let loopCount = 0;
    let actionType, actionDetail, response, summary, functionResponse;

    while (true) {

        if (DEBUG) {
            console.log("[loop] messages before next action:\n\n\n", messages.slice(1));
        }

        try {
            response = await get_next_action(model, messages, objective, accurateMode);
            // response = `CLICK { "x": "50%", "y": "9%", "description": "Click: Chrome Address Bar", "reason": "To type in a news website address or search for the latest news" }`;
            const action = parse_response(response);
            actionType = action.type;
            actionDetail = action.data;
        } catch (e) {
            console.log(chalk.green("[Optimus]") + chalk.red("[Error] -> ") + e);
            break;
        }
        if (actionType === "DONE") {
            console.log(chalk.green("[Optimus]") + chalk.blue(" Objective complete "));
            summary = summarize(model, messages, objective);
            console.log(chalk.green("[Optimus]") + chalk.blue(" Summary\n") + summary);
            break;
        }

        if (actionType !== "UNKNOWN") {
            console.log(chalk.green("[Optimus]") + chalk.magenta(" [Act] ") + actionType + " " + chalk.reset(actionDetail));
        }

        functionResponse = "";
        if (actionType === "SEARCH") {
            functionResponse = await search(actionDetail);
        } else if (actionType === "TYPE") {
            functionResponse = await keyboard_type(actionDetail);
        } else if (actionType === "CLICK") {
            functionResponse = await mouse_click(actionDetail);
        } else {
            console.log(chalk.green("[Optimus]") + chalk.red("[Error] something went wrong :("));
            console.log(chalk.green("[Optimus]") + chalk.red("[Error] AI response\n") + response);
            break;
        }

        console.log(chalk.green("[Optimus]") + chalk.magenta(" [Act] ") + actionType + " COMPLETE " + chalk.reset(functionResponse));

        const message = {
            role: "assistant",
            content: functionResponse,
        };
        messages.push(message);

        loopCount++;
        if (loopCount > 3) {
            break;
        }
    }
}

function clearConsole() {
    if (os.platform() === "win32") {
        console.clear();
    } else {
        process.stdout.write("\x1Bc");
    }
}

async function getUserObjective() {
    const response = await inquirer.prompt([
        {
            name: 'userObjective',
            type: 'input',
            message: chalk.green("[Optimus]\n") + chalk.yellow(USER_QUESTION),
        }
    ]);
    return response.userObjective;
}

const argv = yargs(hideBin(process.argv))
    .usage('Run the self-operating-computer with a specified model.')
    .option('model', {
        alias: 'm',
        describe: 'Specify the model to use',
        type: 'string',
        default: 'gpt-4-vision-preview',
    })
    .option('voice', {
        describe: 'Use voice input mode',
        type: 'boolean',
        default: false,
    })
    .option('accurate', {
        describe: 'Activate Reflective Mouse Click Mode',
        type: 'boolean',
        default: false,
    })
    .option('prompt', {
        describe: 'Directly input the objective prompt',
        type: 'string',
    })
    .help()
    .parse();

process.on('SIGINT', () => {
    console.log('\nExiting...');
    process.exit();
});

main(
    argv.model,
    argv.accurate,
    argv.prompt,
    argv.voice
);
