function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function convertPercentToDecimal(percent) {
    return parseFloat(percent) / 100;
}

export { sleep , convertPercentToDecimal};