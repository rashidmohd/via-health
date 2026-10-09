"""Drawn avatar appearance (ADR 0013): a short description of the user's look that drives the
rigged Rive character (parts + colours). Suggested once from a photo the user chooses, then
reviewed and corrected by the user. Only this description is stored, never the photo."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

HAIR_STYLES = (
    "shaved",
    "short",
    "medium",
    "long",
    "curly_short",
    "curly_long",
    "tied_back",
    "bun",
    "headscarf",
)
GLASSES = ("none", "round", "rectangular")
BEARDS = ("none", "stubble", "short", "full")

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-f]{6}$")]


class Appearance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hair_style: Literal[
        "shaved",
        "short",
        "medium",
        "long",
        "curly_short",
        "curly_long",
        "tied_back",
        "bun",
        "headscarf",
    ]
    hair_color: HexColor
    skin_color: HexColor
    eye_color: HexColor
    glasses: Literal["none", "round", "rectangular"]
    beard: Literal["none", "stubble", "short", "full"]


def _hex(description: str) -> dict[str, Any]:
    return {"type": "string", "pattern": "^#[0-9a-f]{6}$", "description": description}


APPEARANCE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "hair_style": {"type": "string", "enum": list(HAIR_STYLES)},
        "hair_color": _hex("Main hair colour, lowercase hex"),
        "skin_color": _hex("Skin colour of the face in even light, lowercase hex"),
        "eye_color": _hex("Iris colour, lowercase hex; dark brown if unclear"),
        "glasses": {"type": "string", "enum": list(GLASSES)},
        "beard": {"type": "string", "enum": list(BEARDS)},
    },
    "required": ["hair_style", "hair_color", "skin_color", "eye_color", "glasses", "beard"],
}

DESCRIBE_SYSTEM = (
    "You help a person make a friendly illustrated avatar of themselves from their own photo. "
    "Describe only visible appearance for drawing: hairstyle, colours, glasses, beard. "
    "Pick the closest option from each list. Do not judge, guess age, gender, ethnicity, "
    "health, mood or anything else about the person. Answer with JSON only."
)
DESCRIBE_PROMPT = "Describe the person in this photo for their illustrated avatar."
