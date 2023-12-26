class ModelNotRecognizedException extends Error {
    constructor(model, message = "Model not recognized") {
        super(message);
        this.model = model;
        this.name = "ModelNotRecognizedException";
    }

    toString() {
        return `${this.message} : ${this.model}`;
    }
}

export default ModelNotRecognizedException;