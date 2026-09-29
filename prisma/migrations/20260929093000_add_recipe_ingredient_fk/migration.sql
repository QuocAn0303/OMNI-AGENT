-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredientProductId_fkey" FOREIGN KEY ("ingredientProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
