import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";

import { UpdateProfileDto } from "./update-profile.dto";
import { GetProfileQueryDto } from "./get-profile-query.dto";

describe("Profile DTOs", () => {
  const validPublicKey = "GBXGQ55JMQ4L2B6E7S8Y9Z0A1B2C3D4E5F6G7H8I7YWR1234567890AB";

  describe("UpdateProfileDto", () => {
    it("accepts valid complete payload", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        primaryColor: "#6366f1",
        avatarUrl: "https://cdn.example.com/avatar.png",
        bio: "Building payments",
        twitterHandle: "stellarorg",
        discordHandle: "user#1234",
        githubHandle: "stellar",
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("accepts partial payload (only username + publicKey required)", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("accepts null to clear fields", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        primaryColor: null,
        avatarUrl: null,
        bio: null,
        twitterHandle: null,
        discordHandle: null,
        githubHandle: null,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("accepts empty string to clear fields", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        primaryColor: "",
        avatarUrl: "",
        bio: "",
        twitterHandle: "",
        discordHandle: "",
        githubHandle: "",
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("rejects invalid primaryColor format", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        primaryColor: "6366f1", // missing #
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("primaryColor");
    });

    it("rejects invalid avatarUrl (not https)", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        avatarUrl: "http://cdn.example.com/avatar.png",
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("avatarUrl");
    });

    it("rejects bio exceeding max length", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        bio: "A".repeat(161),
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("bio");
    });

    it("rejects twitterHandle exceeding max length", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        twitterHandle: "A".repeat(16),
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("twitterHandle");
    });

    it("rejects discordHandle exceeding max length", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        discordHandle: "A".repeat(33),
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("discordHandle");
    });

    it("rejects githubHandle exceeding max length", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        githubHandle: "A".repeat(40),
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("githubHandle");
    });

    it("rejects missing username", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        publicKey: validPublicKey,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("username");
    });

    it("rejects missing publicKey", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("publicKey");
    });

    it("rejects invalid publicKey format", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: "INVALID_KEY",
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("publicKey");
    });

    it("transforms empty string to null for primaryColor", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        primaryColor: "",
      });
      await validate(dto);
      // After transformation, empty string becomes null
      expect(dto.primaryColor).toBeNull();
    });

    it("transforms empty string to null for avatarUrl", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        avatarUrl: "",
      });
      await validate(dto);
      expect(dto.avatarUrl).toBeNull();
    });

    it("transforms empty string to null for bio", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        bio: "",
      });
      await validate(dto);
      expect(dto.bio).toBeNull();
    });

    it("drops leading @ from twitterHandle", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        twitterHandle: "@stellarorg",
      });
      await validate(dto);
      expect(dto.twitterHandle).toBe("stellarorg");
    });

    it("drops leading @ from githubHandle", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        githubHandle: "@stellar",
      });
      await validate(dto);
      expect(dto.githubHandle).toBe("stellar");
    });

    it("preserves undefined for omitted fields (partial update semantics)", async () => {
      const dto = plainToInstance(UpdateProfileDto, {
        username: "alice_123",
        publicKey: validPublicKey,
        // bio, avatarUrl, etc. are omitted entirely
      });
      await validate(dto);
      // Omitted fields should remain undefined so the service leaves them unchanged
      // Note: plainToInstance only copies own properties from the source object
      expect(Object.prototype.hasOwnProperty.call(dto, "bio")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(dto, "avatarUrl")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(dto, "primaryColor")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(dto, "twitterHandle")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(dto, "discordHandle")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(dto, "githubHandle")).toBe(false);
    });
  });

  describe("GetProfileQueryDto", () => {
    it("accepts valid query", async () => {
      const dto = plainToInstance(GetProfileQueryDto, {
        username: "alice_123",
        publicKey: validPublicKey,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("rejects missing username", async () => {
      const dto = plainToInstance(GetProfileQueryDto, {
        publicKey: validPublicKey,
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("username");
    });

    it("rejects missing publicKey", async () => {
      const dto = plainToInstance(GetProfileQueryDto, {
        username: "alice_123",
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("publicKey");
    });

    it("rejects invalid publicKey format", async () => {
      const dto = plainToInstance(GetProfileQueryDto, {
        username: "alice_123",
        publicKey: "INVALID",
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe("publicKey");
    });
  });
});